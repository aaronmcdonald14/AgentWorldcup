// netlify/functions/football-data.mjs
// Instant reader. Serves the central Blobs store (shared by every visitor,
// kept fresh every minute by update-scores). Falls back to a one-off live
// fetch only if the store is empty (e.g. first minute after deploy).

import { getStore } from "@netlify/blobs";

const API_URL = "https://api.football-data.org/v4/competitions/WC/matches";
const CORS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json", "Cache-Control": "no-store" };
const CACHE_HEADERS = {
  "Cache-Control": "public, max-age=0, must-revalidate",
  "Netlify-CDN-Cache-Control": "public, s-maxage=60, stale-while-revalidate=30",
};
const reply = (obj, extra) => ({ statusCode: 200, headers: { ...CORS, ...(extra || {}) }, body: JSON.stringify(obj) });

async function fetchWC(KEY) {
  const r = await fetch(API_URL, { headers: { "X-Auth-Token": KEY } });
  if (!r.ok) { const e = new Error("api_http_" + r.status); e.status = r.status; throw e; }
  const d = await r.json();
  const matches = (d.matches || []).map(m => ({
    group: (m.group || "").replace(/^GROUP_/, ""),
    home: (m.homeTeam && m.homeTeam.name) || "",
    away: (m.awayTeam && m.awayTeam.name) || "",
    utcDate: m.utcDate || "",
    hs: m.score && m.score.fullTime ? m.score.fullTime.home : null,
    as: m.score && m.score.fullTime ? m.score.fullTime.away : null,
    htH: m.score && m.score.halfTime ? m.score.halfTime.home : null,
    htA: m.score && m.score.halfTime ? m.score.halfTime.away : null,
    status: m.status || "",
  })).filter(x => x.home && x.away);
  return { source: "football-data.org", count: matches.length, matches, updated: new Date().toISOString() };
}

export const handler = async (event) => {
  const debug = event.queryStringParameters && event.queryStringParameters.debug;

  // 1) Serve the central store instantly.
  try {
    const data = await getStore("scores").get("latest", { type: "json" });
    if (data && data.matches && data.matches.length) {
      if (debug) return reply({ debug: true, served_from: "blob", updated: data.updated, count: data.count });
      return reply(data, CACHE_HEADERS);
    }
  } catch (e) { /* store unavailable -> fall through */ }

  // 2) Store empty (cold start): fetch once, seed it, return.
  const KEY = process.env.FOOTBALL_DATA_KEY;
  if (!KEY) {
    if (debug) { const all = Object.keys(process.env); return reply({ error: "no_key", served_from: "none", matching_var_names: all.filter(n => /foot|data|key|token|api/i.test(n)), total_vars: all.length }); }
    return reply({ error: "no_key", hint: "Add FOOTBALL_DATA_KEY in Netlify env vars, then redeploy." });
  }
  try {
    const data = await fetchWC(KEY);
    if (!data.matches.length) return reply({ error: "no_matches", hint: "API reachable but no fixtures yet." });
    try { await getStore("scores").setJSON("latest", data); } catch (e) {}
    if (debug) return reply({ debug: true, served_from: "live", count: data.count });
    return reply(data, CACHE_HEADERS);
  } catch (e) {
    const hint = e.status === 403 ? "World Cup not on your free plan — tell me and I'll switch to API-Football."
      : e.status === 429 ? "Rate limited (free tier = 10/min)." : undefined;
    return reply({ error: e.message || String(e), hint });
  }
};
