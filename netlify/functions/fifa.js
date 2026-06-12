// netlify/functions/fifa.js
// Runs on Netlify's servers (not the browser), so it can fetch fifa.com
// without CORS problems. It loads the FIFA fixtures page, pulls the match
// data FIFA embeds in the HTML (__NEXT_DATA__), and returns a clean shape
// the site understands: { source, groups, matches:[{group,home,away,utcDate,hs,as,status}] }.
//
// Endpoint:  /.netlify/functions/fifa
// Debug:     /.netlify/functions/fifa?debug=1   -> raw structure, to refine the mapping.

const FIFA_URL =
  "https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/scores-fixtures?country=GB&wtw-filter=ALL";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
  "Cache-Control": "public, max-age=300", // 5 min edge cache; page still refreshes every 30
};

// ---- small helpers -------------------------------------------------------
const firstString = (...vals) => vals.find(v => typeof v === "string" && v.trim()) || "";
const numOrNull = v => (v === 0 || (typeof v === "number" && !isNaN(v))) ? v
  : (typeof v === "string" && v.trim() !== "" && !isNaN(+v)) ? +v : null;

function teamName(o) {
  if (!o) return "";
  if (typeof o === "string") return o;
  return firstString(o.name, o.teamName, o.shortName, o.shortClubName, o.abbreviation, o.countryName, o.title);
}

// Walk the whole JSON tree and collect anything that looks like a match.
function harvest(node, out, depth = 0) {
  if (!node || depth > 12) return;
  if (Array.isArray(node)) { node.forEach(n => harvest(n, out, depth + 1)); return; }
  if (typeof node !== "object") return;

  const homeRaw = node.home ?? node.homeTeam ?? node.teamHome ?? node.competitorHome;
  const awayRaw = node.away ?? node.awayTeam ?? node.teamAway ?? node.competitorAway;
  const home = teamName(homeRaw), away = teamName(awayRaw);

  if (home && away) {
    const utcDate = firstString(node.utcDate, node.dateTime, node.date, node.localDate, node.kickoff, node.startDate);
    const group = firstString(node.groupName, node.group, node.stageName, node.stage, node.round, node.phase)
      .replace(/^group\s*/i, "").trim();
    const hs = numOrNull(node.homeScore ?? node.homeGoals ?? node.scoreHome ?? homeRaw?.score ?? homeRaw?.goals ?? node.home_score);
    const as = numOrNull(node.awayScore ?? node.awayGoals ?? node.scoreAway ?? awayRaw?.score ?? awayRaw?.goals ?? node.away_score);
    const status = firstString(node.status, node.matchStatus, node.statusName);
    out.push({ group, home, away, utcDate, hs, as, status });
  }
  for (const k in node) harvest(node[k], out, depth + 1);
}

function groupsFromMatches(matches) {
  const g = {};
  matches.forEach(m => {
    const k = (m.group || "").replace(/^group[_ ]?/i, "").trim().toUpperCase();
    if (!k || k.length > 2) return; // keep group-stage letters; skip "Round of 16" etc.
    g[k] = g[k] || [];
    [m.home, m.away].forEach(t => { if (t && !g[k].includes(t)) g[k].push(t); });
  });
  return g;
}

exports.handler = async (event) => {
  const debug = event.queryStringParameters && event.queryStringParameters.debug;
  try {
    const r = await fetch(FIFA_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; AgentSweep/1.0)",
        "Accept": "text/html,application/json",
        "Accept-Language": "en-GB,en;q=0.9",
      },
    });
    if (!r.ok) return { statusCode: 200, headers: CORS, body: JSON.stringify({ error: "fifa_http_" + r.status }) };
    const html = await r.text();

    // FIFA is a Next.js app: match data is embedded as JSON in the page.
    const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) return { statusCode: 200, headers: CORS, body: JSON.stringify({ error: "no_embedded_json", hint: "FIFA changed the page; send me the debug output" }) };

    const data = JSON.parse(m[1]);

    if (debug) {
      // Trim so the payload is readable when refining the mapping.
      const sample = JSON.stringify(data).slice(0, 4000);
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ debug: true, topKeys: Object.keys(data), propsKeys: data.props ? Object.keys(data.props) : null, sample }, null, 2) };
    }

    const matches = [];
    harvest(data, matches);
    // de-dupe
    const seen = new Set();
    const clean = matches.filter(x => {
      const id = x.home + "|" + x.away + "|" + x.utcDate;
      if (seen.has(id)) return false; seen.add(id); return true;
    });

    if (!clean.length) return { statusCode: 200, headers: CORS, body: JSON.stringify({ error: "no_matches_found", hint: "Hit ?debug=1 and send me the output to finish the mapping." }) };

    return {
      statusCode: 200, headers: CORS,
      body: JSON.stringify({ source: "fifa.com", count: clean.length, groups: groupsFromMatches(clean), matches: clean }),
    };
  } catch (e) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ error: String(e && e.message || e) }) };
  }
};
