// netlify/functions/update-scores.mjs
// Scheduled task: every minute it refreshes the central scores store (Netlify
// Blobs). If a refresh fails, the previous stored value is kept, so the site
// always has the last-known scores — survives API hiccups and quiet periods.

import { getStore } from "@netlify/blobs";
import { schedule } from "@netlify/functions";

const API_URL = "https://api.football-data.org/v4/competitions/WC/matches";

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
    status: m.status || "",
  })).filter(x => x.home && x.away);
  return { source: "football-data.org", count: matches.length, matches, updated: new Date().toISOString() };
}

export const handler = schedule("* * * * *", async () => {
  const KEY = process.env.FOOTBALL_DATA_KEY;
  if (!KEY) return { statusCode: 200 };
  try {
    const data = await fetchWC(KEY);
    if (data.matches.length) {
      await getStore("scores").setJSON("latest", data);
    }
  } catch (e) { /* keep the last good value */ }
  return { statusCode: 200 };
});
