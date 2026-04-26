# Cloudflare Storage Plan

This project is a good fit for a split storage design on Cloudflare rather than a single database.

## Recommended layout

- `Workers Cron Trigger`
  Runs every minute and fetches the latest global flight snapshot.
- `KV`
  Stores the current global snapshot pointer and hot per-flight detail cache.
- `R2`
  Stores raw per-minute snapshot blobs for replay, audit, and future analytics.
- `D1` optional
  Only add this if we later need queryable history, alerting rules, or derived aggregates.

## Why this split

- The full `states/all` payload is read-heavy and changes on a predictable interval.
- Individual flight detail lookups are small objects and benefit from TTL-based caching.
- Snapshot archives are blob-like and should not live in a relational table by default.

## Suggested keys

- KV: `flights:latest`
  Latest normalized full snapshot metadata plus the current archive object key.
- KV: `flight-detail:<flightId>`
  Cached enriched detail payload for a specific flight.
- R2: `snapshots/YYYY/MM/DD/HH/mm.json`
  Raw or normalized full snapshot captured each minute.

## Suggested TTLs

- `flights:latest`
  90 to 120 seconds.
- `flight-detail:<flightId>`
  10 to 30 minutes, depending on traffic and upstream stability.

## Worker flow

1. Cron runs every minute.
2. Fetch upstream full snapshot.
3. Write raw snapshot to R2.
4. Update `flights:latest` in KV with a compact current snapshot or the R2 object pointer.
5. API reads `flights:latest` from KV for fast global reads.
6. API resolves a clicked flight detail from KV first, then upstream on miss, then writes back to KV.

## When to introduce D1

Use D1 only if we need:

- historical flight queries by country / airline / airport
- materialized alert history
- user-saved watchlists or rules
- ad hoc dashboards over historical metadata

## Practical note

KV is a strong fit for hot reads and TTL caches, but it is eventually consistent.
R2 is a better fit for minute snapshots because it is strongly consistent per object and scales naturally for archive blobs.
