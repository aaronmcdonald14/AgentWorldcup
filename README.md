# Agent World Cup Sweep 2026

Sweepstake board for the 2026 World Cup: 48 teams by group with each entrant's
name, flags, dates, group tables, leaderboard and knockout bracket. Live scores
come from football-data.org and are stored centrally so every visitor sees the
latest scores the instant the page loads.

## How the scoring works
1. `update-scores.mjs` runs every minute, fetches the World Cup matches and
   writes them to a central Netlify Blobs store ("scores" / "latest").
2. `football-data.mjs` (the endpoint the site calls) serves that stored value
   instantly to everyone, and refreshes it on a cold start if it's ever empty.
3. If a refresh fails, the last good value stays in the store — the board never
   goes blank or stale-wipes.

Because the scores live in a shared store (not each person's browser), a brand
new visitor sees the current scores immediately, even mid-match.

## This version needs a build, so deploy from GitHub
Blobs + the scheduled task rely on npm packages, so Netlify needs to install
them — that happens automatically on a Git deploy (not on drag-and-drop).

1. Put these files in a GitHub repo (drag them into a new repo in the browser,
   or `git init && git add . && git commit && git push`). Do NOT commit
   `node_modules` — Netlify installs it.
2. In Netlify, open your existing site -> Site configuration -> Build & deploy
   -> link it to the GitHub repo (this keeps your agentworldcup.netlify.app URL
   and your FOOTBALL_DATA_KEY env var). No build command needed; publish dir is
   the repo root.
3. Deploy. Confirm `FOOTBALL_DATA_KEY` is still set under Environment variables.

## Check it
- `https://agentworldcup.netlify.app/.netlify/functions/football-data?debug=1`
  shows `served_from`: `blob` (from the central store) or `live` (cold start).
- The site header pill reads `Live · API`.
- New scores land in the store within a minute and show up for everyone.

## Notes
- The 12 groups are fixed in the `GROUPS` object in `index.html`; the feed only
  attaches scores/dates, never changes group membership.
- The scrapers `bbc.js` / `fifa.js` remain as fallbacks if the API is down.
- Brand colour: change `--brand` at the top of the `<style>` block in index.html.
