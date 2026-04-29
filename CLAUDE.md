# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

Artist website for **DOOMSAYER** (iamdoomsayer.com), deployed on Vercel. It has two parts:

- `public/` — static HTML/CSS/JS frontend (no build step; files are served directly)
- `api/` — Vercel serverless functions (Node.js 18, ES module syntax)

## Deployment

Deploy via Vercel. There is no local dev server setup — test API functions by deploying or by running `vercel dev` if the CLI is installed. The `api/vercel.json` configures function runtimes and cron schedules.

## API functions

All functions in `api/` are Vercel serverless handlers that export a default `async function handler(req, res)`.

| File | Purpose |
|------|---------|
| `soundcloud.js` | Proxy to SoundCloud API — accepts `?endpoint=` query param, handles OAuth token with Redis cache |
| `snapshot.js` | GET returns latest stats + history; POST triggers SoundCloud stats snapshot and stores in Redis |
| `chartmetric.js` | Fetches Spotify/TikTok/Instagram stats from Chartmetric API (artist ID `9194995`) and merges into snapshot |
| `ritual.js` | Weekly leaderboard for a game — GET top 10, POST to submit score; scoped by ISO week key in Redis |
| `checkout.js` | Creates a Stripe Checkout session for Printify products; returns redirect URL |
| `printify.js` | Proxy to Printify API — accepts `?endpoint=` query param |
| `subscribe.js` | Mailing list via Redis sorted set; GET (admin key required) lists emails, POST adds one |

## Data layer

All persistence uses **Upstash Redis** (`@upstash/redis`), initialized from env via `Redis.fromEnv()`. Key Redis keys:

- `sc_token` — cached SoundCloud OAuth token
- `cm_token` — cached Chartmetric token
- `latest_snapshot` — merged object of SoundCloud + Chartmetric stats
- `snapshots` — array of up to 90 historical daily snapshots
- `ritual:week:YYYY-M-D` — weekly game leaderboard (expires after 14 days)
- `mailing_list` — sorted set of subscriber emails (score = timestamp)

## Environment variables required

`SOUNDCLOUD_CLIENT_ID`, `SOUNDCLOUD_CLIENT_SECRET`, `CHARTMETRIC_API_KEY`, `STRIPE_SECRET_KEY`, `PRINTIFY_API_KEY`, `ADMIN_KEY`, plus the Upstash Redis vars consumed by `Redis.fromEnv()` (`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`).

## Cron jobs (defined in `api/vercel.json`)

- `/api/snapshot` — runs daily at 17:00 UTC (SoundCloud stats)
- `/api/chartmetric` — runs every 4 days at 17:00 UTC

## Frontend

`public/index.html` is a single-file page (inline CSS + JS, no bundler). It uses the custom cursor, canvas animations, and calls the proxy API functions via `fetch`. `public/epk/index.html` and `public/ritual/index.html` are standalone sub-pages.
