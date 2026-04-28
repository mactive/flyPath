# Cloudflare Storage Plan

This project is a good fit for a split storage design on Cloudflare rather than a single database.

## Recommended layout

- `Workers Cron Trigger`
  Runs every minute and fetches the latest global flight snapshot, airport boards, and rebuilds the cached route catalog.
- `KV`
  Stores the current global snapshot pointer, hot per-flight detail cache, route detail entities, and the latest route catalog snapshot.
- `R2`
  Stores raw per-minute snapshot blobs for replay, audit, and future analytics.
- `D1`
  Stores queryable live-route state and becomes the primary filter engine once route intelligence moves beyond KV-level faceting.

## Why this split

- The full `states/all` payload is read-heavy and changes on a predictable interval.
- Individual flight detail lookups are small objects and benefit from TTL-based caching.
- Route filters such as airline / aircraft / haul type need a normalized entity layer instead of repeatedly parsing raw detail payloads in the frontend.
- Snapshot archives are blob-like and should not live in a relational table by default.

## Suggested keys

- KV: `flights:latest`
  Latest normalized full snapshot metadata plus the current archive object key.
- KV: `flight-detail:<flightId>`
  Cached enriched detail payload for a specific flight.
- KV: `route-detail:<origin>-<destination>`
  Cached route entity derived from flight detail, including airports, haul distance, airlines, aircraft models, and recent sample flights.
- KV: `route-catalog:latest`
  Latest aggregated route list plus available filter facets for the UI.
- R2: `snapshots/YYYY/MM/DD/HH/mm.json`
  Raw or normalized full snapshot captured each minute.
- D1: `live_flights`
  Current tracked flights plus the latest successful route, airline, aircraft, and airport enrichment fields.
- D1: `route_profiles`
  Normalized route metadata keyed by `origin-destination`.

## Suggested TTLs

- `flights:latest`
  90 to 120 seconds.
- `flight-detail:<flightId>`
  10 to 30 minutes, depending on traffic and upstream stability.
- `route-detail:<origin>-<destination>`
  7 to 30 days. This should outlive single-flight detail TTL because it is the reusable entity for filtering and route facts.
- `route-catalog:latest`
  3 to 5 minutes. It is cheap to rebuild from cached route entities and should stay reasonably fresh.

## Worker flow

1. Cron runs every minute.
2. Fetch upstream full snapshot.
3. Write raw snapshot to R2.
4. Update `flights:latest` in KV with a compact current snapshot or the R2 object pointer.
5. Refresh top airport boards.
6. Rebuild `route-catalog:latest` from cached `route-detail:*` entities.
7. API reads `flights:latest` from KV for fast global reads.
8. API resolves a clicked flight detail from KV first, then upstream on miss, then writes back to KV.
9. Every successful detail read also upserts a normalized `route-detail:<origin>-<destination>` entity and invalidates the cached route catalog snapshot.
10. A separate D1 enrichment loop snapshots current live flights, picks a bounded batch of due airborne tracks, resolves search + detail upstreams, and updates `live_flights` / `route_profiles`.

## When to rely on D1

Use D1 when we need:

- historical flight queries by country / airline / airport
- route history with exact counts over time
- materialized alert history
- user-saved watchlists or rules
- ad hoc dashboards over historical metadata
- complex live filters such as "Emirates airborne routes" or "A380 from DXB with route distance > 4000km"

## Practical note

KV is a strong fit for hot reads and TTL caches, but it is eventually consistent.
R2 is a better fit for minute snapshots because it is strongly consistent per object and scales naturally for archive blobs.
The route catalog is only as complete as the cached route-detail coverage. If we later want near-full live coverage, add a bounded route-detail prewarm pass or move route indexing into a queryable store such as D1.
