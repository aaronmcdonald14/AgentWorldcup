// netlify/functions/fifa-standings.js
// Server-side fetch of FIFA's official group standings table, normalised to:
// { source, standings:[{group,team,position,P,W,D,L,GF,GA,Pts}] }
//
// Endpoint:  /.netlify/functions/fifa-standings
// Debug:     /.netlify/functions/fifa-standings?debug=1

const STANDINGS_URL =
  "https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/standings";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
  "Cache-Control": "public, max-age=300",
};

const firstString = (...v) => v.find(x => typeof x === "string" && x.trim()) || "";
const numOr = (v, d = null) => (v === 0 || (typeof v === "number" && !isNaN(v))) ? v
  : (typeof v === "string" && v.trim() !== "" && !isNaN(+v)) ? +v : d;

function teamName(o) {
  if (!o) return "";
  if (typeof o === "string") return o;
  return firstString(o.name, o.teamName, o.shortName, o.countryName, o.title, o.abbreviation);
}

// A node is a standings row if it names a team and carries points + (played or position).
function isRow(n) {
  if (!n || typeof n !== "object") return false;
  const team = teamName(n.team || n.competitor || n);
  const pts = numOr(n.points ?? n.pts ?? n.point);
  const played = numOr(n.played ?? n.matchesPlayed ?? n.pld ?? n.games ?? n.gamesPlayed);
  const pos = numOr(n.position ?? n.rank ?? n.place ?? n.standingPosition);
  return !!team && pts != null && (played != null || pos != null);
}

function readRow(n, groupCtx) {
  const team = teamName(n.team || n.competitor || n);
  const GF = numOr(n.goalsFor ?? n.for ?? n.gf ?? n.scored ?? n.goalsScored, 0);
  const GA = numOr(n.goalsAgainst ?? n.against ?? n.ga ?? n.conceded ?? n.goalsConceded, 0);
  return {
    group: firstString(n.groupName, n.group, groupCtx).replace(/^group\s*/i, "").trim(),
    team,
    position: numOr(n.position ?? n.rank ?? n.place ?? n.standingPosition),
    P: numOr(n.played ?? n.matchesPlayed ?? n.pld ?? n.games ?? n.gamesPlayed, 0),
    W: numOr(n.won ?? n.wins ?? n.w, 0),
    D: numOr(n.drawn ?? n.draws ?? n.draw ?? n.tied ?? n.d, 0),
    L: numOr(n.lost ?? n.losses ?? n.loss ?? n.l, 0),
    GF, GA,
    Pts: numOr(n.points ?? n.pts ?? n.point, 0),
  };
}

// Walk the tree, carrying the nearest group label down to its rows.
function harvest(node, out, groupCtx, depth = 0) {
  if (!node || depth > 14) return;
  if (Array.isArray(node)) { node.forEach(n => harvest(n, out, groupCtx, depth + 1)); return; }
  if (typeof node !== "object") return;

  let ctx = groupCtx;
  const label = firstString(node.groupName, node.group, node.stageName, node.stage);
  if (label) { const g = label.replace(/^group\s*/i, "").trim(); if (g && g.length <= 2) ctx = g; }

  if (isRow(node)) out.push(readRow(node, ctx));
  for (const k in node) harvest(node[k], out, ctx, depth + 1);
}

exports.handler = async (event) => {
  const debug = event.queryStringParameters && event.queryStringParameters.debug;
  try {
    const r = await fetch(STANDINGS_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; AgentSweep/1.0)",
        "Accept": "text/html,application/json",
        "Accept-Language": "en-GB,en;q=0.9",
      },
    });
    if (!r.ok) return { statusCode: 200, headers: CORS, body: JSON.stringify({ error: "fifa_http_" + r.status }) };
    const html = await r.text();

    const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) return { statusCode: 200, headers: CORS, body: JSON.stringify({ error: "no_embedded_json", hint: "send me ?debug=1 output" }) };
    const data = JSON.parse(m[1]);

    if (debug) {
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ debug: true, topKeys: Object.keys(data), propsKeys: data.props ? Object.keys(data.props) : null, sample: JSON.stringify(data).slice(0, 4000) }, null, 2) };
    }

    const rows = [];
    harvest(data, rows, "");
    const seen = new Set();
    const clean = rows.filter(x => { const id = x.group + "|" + x.team; if (seen.has(id)) return false; seen.add(id); return true; });

    if (!clean.length) return { statusCode: 200, headers: CORS, body: JSON.stringify({ error: "no_standings_found", hint: "Hit ?debug=1 and send me the output to finish the mapping." }) };

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ source: "fifa.com", count: clean.length, standings: clean }) };
  } catch (e) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ error: String(e && e.message || e) }) };
  }
};
