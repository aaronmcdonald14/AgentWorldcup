// netlify/functions/bbc.js
// Server-side fetch of the BBC World Cup schedule page, normalised to:
// { source, groups, matches:[{group,home,away,utcDate,hs,as,status}] }
//
// Endpoint:  /.netlify/functions/bbc
// Debug:     /.netlify/functions/bbc?debug=1   -> what JSON the page actually contains
//
// Note: the BBC *schedule* lists games by date and may not label group letters.
// If `groups` comes back empty, keep the real draw hard-coded in index.html and
// let this function supply scores/dates only.

const BBC_URL = "https://www.bbc.co.uk/sport/football/world-cup/schedule";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
  "Cache-Control": "public, max-age=300",
};

const firstString = (...v) => v.find(x => typeof x === "string" && x.trim()) || "";
const numOr = v => (v === 0 || (typeof v === "number" && !isNaN(v))) ? v
  : (typeof v === "string" && v.trim() !== "" && !isNaN(+v)) ? +v : null;

function teamName(o) {
  if (!o) return "";
  if (typeof o === "string") return o;
  return firstString(o.name, o.teamName, o.shortName, o.fullName, o.countryName, o.title);
}

function harvest(node, out, groupCtx, depth = 0) {
  if (!node || depth > 14) return;
  if (Array.isArray(node)) { node.forEach(n => harvest(n, out, groupCtx, depth + 1)); return; }
  if (typeof node !== "object") return;

  let ctx = groupCtx;
  const label = firstString(node.group, node.groupName, node.stage, node.stageName, node.round, node.tournamentStage, node.name);
  const gm = label.match(/group\s*([a-l])/i);
  if (gm) ctx = gm[1].toUpperCase();

  const homeRaw = node.homeTeam ?? node.home ?? node.teamHome ?? (Array.isArray(node.competitors) ? node.competitors[0] : undefined);
  const awayRaw = node.awayTeam ?? node.away ?? node.teamAway ?? (Array.isArray(node.competitors) ? node.competitors[1] : undefined);
  const home = teamName(homeRaw), away = teamName(awayRaw);
  if (home && away) {
    out.push({
      group: ctx,
      home, away,
      utcDate: firstString(node.startDate, node.startTime, node.date, node.kickOffTime, node.dateTime, node.utcDate),
      hs: numOr(node.homeScore ?? node.homeTeamScore ?? homeRaw?.score ?? homeRaw?.goals ?? node.scores?.home),
      as: numOr(node.awayScore ?? node.awayTeamScore ?? awayRaw?.score ?? awayRaw?.goals ?? node.scores?.away),
      status: firstString(node.eventStatus, node.status, node.statusType, node.eventProgress?.status),
    });
  }
  for (const k in node) harvest(node[k], out, ctx, depth + 1);
}

function groupsFromMatches(matches) {
  const g = {};
  matches.forEach(m => {
    const k = (m.group || "").trim().toUpperCase();
    if (!k || k.length > 2) return;
    g[k] = g[k] || [];
    [m.home, m.away].forEach(t => { if (t && !g[k].includes(t)) g[k].push(t); });
  });
  return g;
}

exports.handler = async (event) => {
  const debug = event.queryStringParameters && event.queryStringParameters.debug;
  try {
    const r = await fetch(BBC_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; AgentSweep/1.0)",
        "Accept": "text/html",
        "Accept-Language": "en-GB,en;q=0.9",
      },
    });
    if (!r.ok) return { statusCode: 200, headers: CORS, body: JSON.stringify({ error: "bbc_http_" + r.status }) };
    const html = await r.text();

    // BBC embeds data in a few possible shapes — gather all candidates.
    const blobs = [];
    let m;
    const reNext = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/g;
    while ((m = reNext.exec(html))) blobs.push(m[1]);
    const reLd = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;
    while ((m = reLd.exec(html))) blobs.push(m[1]);
    const reInit = /window\.__INITIAL_DATA__\s*=\s*"((?:\\.|[^"\\])*)"/;
    const mi = html.match(reInit);
    if (mi) { try { blobs.push(JSON.parse('"' + mi[1] + '"')); } catch (e) {} }

    if (debug) {
      return {
        statusCode: 200, headers: CORS,
        body: JSON.stringify({ debug: true, blobCount: blobs.length, sizes: blobs.map(b => b.length), sample: (blobs[0] || "").slice(0, 4000) }, null, 2),
      };
    }

    const matches = [];
    for (const b of blobs) { try { harvest(JSON.parse(b), matches, ""); } catch (e) {} }

    const seen = new Set();
    const clean = matches.filter(x => { const id = x.home + "|" + x.away + "|" + x.utcDate; if (seen.has(id)) return false; seen.add(id); return true; });
    if (!clean.length) return { statusCode: 200, headers: CORS, body: JSON.stringify({ error: "no_matches_found", hint: "Hit ?debug=1 and send me the output." }) };

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ source: "bbc.co.uk", count: clean.length, groups: groupsFromMatches(clean), matches: clean }) };
  } catch (e) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ error: String(e && e.message || e) }) };
  }
};
