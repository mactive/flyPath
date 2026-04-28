# Flight Monitor Agent Memory

## Project Goal

This project is a global flight tracking website with a tactical operations-style UI.

Core product goals:
- Render a global live flight map with smooth zoom/pan interactions.
- Show sampled global traffic by default, and full traffic when drilling into a country.
- Click a flight to inspect its route, airports, live status, and detail chain.
- Cache upstream data behind a Hono service, with Cloudflare Workers as the primary deployment target.

## Current Stack

Frontend:
- Vite
- React 18
- TypeScript
- MapLibre GL JS
- PMTiles protocol support
- Three.js

Backend:
- Hono
- Cloudflare Workers
- Wrangler
- Cloudflare KV
- Cloudflare R2
- Cloudflare D1

Fallback local/server mode:
- Hono on Node via `@hono/node-server`

## Runtime Topology

### Frontend

Main UI entry:
- [src/App.tsx](/Users/bytedance/Project/SideCar/flightMonitor/src/App.tsx)

Map implementation:
- [src/components/FlightMap.tsx](/Users/bytedance/Project/SideCar/flightMonitor/src/components/FlightMap.tsx)

Visual shell and styling:
- [src/styles.css](/Users/bytedance/Project/SideCar/flightMonitor/src/styles.css)
- [src/components/GlobeBackdrop.tsx](/Users/bytedance/Project/SideCar/flightMonitor/src/components/GlobeBackdrop.tsx)

### Primary backend: Cloudflare Worker

Worker entry:
- [worker/index.ts](/Users/bytedance/Project/SideCar/flightMonitor/worker/index.ts)

API routes:
- [worker/app.ts](/Users/bytedance/Project/SideCar/flightMonitor/worker/app.ts)

Caching and upstream orchestration:
- [worker/storage.ts](/Users/bytedance/Project/SideCar/flightMonitor/worker/storage.ts)
- [worker/upstream.ts](/Users/bytedance/Project/SideCar/flightMonitor/worker/upstream.ts)
- [worker/constants.ts](/Users/bytedance/Project/SideCar/flightMonitor/worker/constants.ts)
- [worker/bindings.ts](/Users/bytedance/Project/SideCar/flightMonitor/worker/bindings.ts)

Cloudflare config:
- [wrangler.jsonc](/Users/bytedance/Project/SideCar/flightMonitor/wrangler.jsonc)

### Local fallback backend

Node app:
- [server/app.ts](/Users/bytedance/Project/SideCar/flightMonitor/server/app.ts)
- [server/provider.ts](/Users/bytedance/Project/SideCar/flightMonitor/server/provider.ts)

This exists mainly for local or fallback single-service runs. The Cloudflare Worker path is the canonical deployment target.

## Data Sources

Current upstreams:
- Full flight list: `https://flight-viz.com/api/states/all`
- FR24 search proxy: `https://flight-viz-proxy.flight-viz.workers.dev/fr24/search`
- FR24 detail proxy: `https://flight-viz-proxy.flight-viz.workers.dev/fr24/detail`
- FR24 airport board proxy: `https://flight-viz-proxy.flight-viz.workers.dev/fr24/airport`

Important note:
- The frontend should not call these upstreams directly.
- All upstream access is brokered through the local Hono server or Cloudflare Worker.

## Current Frontend Behavior

### Map

The map is MapLibre-based, not a custom bitmap or Natural Earth canvas anymore.

Supported interactions:
- wheel zoom
- drag pan
- `W/A/S/D` keyboard pan
- click flight to select
- hover flight for tooltip

Map overlay behavior:
- default global rendering only shows about `1/4` of flights for performance
- when a country is selected, that country renders full matching traffic
- clicking `World` returns to the global view
- clicking a country fits bounds to that country using the full country flight set, not the sampled render set

Flight visual behavior:
- flight points have a `1px` gray outline for readability on colorful vector maps
- hover adds a 2x enlargement/glow animation
- hover tooltip shows `callsign / altitude / speed`
- selected flight renders route trail and projection lines
- route line colors are black/dark for contrast over the map

### Layout

Left rail:
- query input
- country filters
- fast movers
- KPI cards pinned at the bottom:
  - Peak altitude
  - Fastest track
  - Grounded share

Center lower strip:
- real airport departure boards for top 20 airports
- horizontally auto-scrolling
- hover pauses marquee

Right rail:
- selected flight detail panel
- flight metrics
- enriched FR24 route/airport detail

## Current API Surface

Worker and Node fallback both expose:
- `GET /api/health`
- `GET /api/states/all`
- `GET /api/fr24/search`
- `GET /api/fr24/detail`
- `GET /api/boards/top-airports`

Meaning:
- `/api/states/all` returns the latest cached full snapshot
- `/api/fr24/search` resolves a flight search chain
- `/api/fr24/detail` resolves a single flight detail payload
- `/api/boards/top-airports` returns aggregated departure boards for configured top airports

Worker-only cached route APIs:
- `GET /api/routes/catalog`
- `GET /api/routes/detail`
- `GET /api/live-routes`

Meaning:
- `/api/routes/catalog` returns cached route summaries plus filter facets for airline / aircraft / haul / airport / country
- `/api/routes/detail` returns a normalized cached route entity keyed by `origin-destination`
- `/api/live-routes` queries the D1-backed current live route index and returns flights plus aggregated route matches for map rendering

## Caching Strategy

### Cloudflare

KV:
- latest full snapshot
- latest snapshot metadata
- flight search cache
- flight detail cache
- top airport boards cache
- route detail entity cache
- route catalog snapshot cache

D1:
- live flight index
- route profiles
- bounded enrich scheduling state stored on current live flight rows

R2:
- archived minute-level full flight snapshots

Cron:
- runs every minute via `wrangler` cron trigger
- refreshes:
  - latest full flight snapshot
  - top airport departure boards

Important files:
- [worker/index.ts](/Users/bytedance/Project/SideCar/flightMonitor/worker/index.ts)
- [worker/storage.ts](/Users/bytedance/Project/SideCar/flightMonitor/worker/storage.ts)

Current TTL defaults from `wrangler.jsonc`:
- snapshot: `90s`
- search: `300s`
- detail: `1800s`
- airport boards: `240s`
- route detail: `2592000s`
- route catalog: `300s`
- live route success revalidate: `720s`
- live route enrich batch: `24`

### Node fallback

Uses in-memory cache only:
- full snapshot
- search
- detail
- airport boards

This is not the production persistence layer.

## Top Airport Boards

The airport board feature is backed by FR24 airport payloads and currently uses these default airports:

- `HND, ATL, DXB, LHR, DFW, DEN, IST, ORD, LAX, DEL, CDG, AMS, FRA, SIN, ICN, CAN, PVG, JFK, BKK, MAD`

Worker config source:
- `TOP_AIRPORT_CODES` in [wrangler.jsonc](/Users/bytedance/Project/SideCar/flightMonitor/wrangler.jsonc)

Node fallback source:
- hardcoded list in [server/provider.ts](/Users/bytedance/Project/SideCar/flightMonitor/server/provider.ts)

If this list changes later, keep Worker and Node fallback aligned.

## Build And Dev Commands

Primary local development:
```bash
npm run dev
```

This starts:
- Vite client
- Wrangler local worker

Other useful commands:
```bash
npm run dev:client
npm run dev:worker
npm run build
npm run build:client
npm run build:server
npm run typecheck:worker
npm run deploy:worker
```

## Deployment Notes

Canonical deployment is Cloudflare Workers.

Requirements:
- KV binding: `FLIGHT_CACHE`
- R2 binding: `SNAPSHOT_ARCHIVE`
- assets binding: `ASSETS`
- cron trigger: every minute

Related docs:
- [docs/cloudflare-storage.md](/Users/bytedance/Project/SideCar/flightMonitor/docs/cloudflare-storage.md)
- [docs/cloudflare-workers-deploy.md](/Users/bytedance/Project/SideCar/flightMonitor/docs/cloudflare-workers-deploy.md)

## Known Constraints

- Map bundle is still large; `FlightMap` chunk remains heavy.
- Airport board data depends on the FR24 proxy endpoint structure remaining stable.
- Upstream licensing and redistribution constraints should be reviewed before a public commercial deployment.
- The repo still keeps both Worker and Node server implementations; Worker is the source of truth.

## Recommended Next Principles For Future Changes

- Do not let the frontend call upstream flight APIs directly.
- Prefer adding new cached API routes in Worker first, then mirror them in Node fallback only if needed.
- Keep country zoom based on full country flight sets, not sampled render sets.
- Preserve global sampling for performance unless the map rendering model changes materially.
- Keep Cloudflare cron, KV keys, and frontend polling cadence consistent when introducing new cached resources.
