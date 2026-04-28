# Cloudflare Workers Deployment

This repo now includes a Worker-native Hono service.

## Files

- `wrangler.jsonc`
  Main Worker config, cron trigger, KV/R2 bindings, and static asset binding.
- `worker/index.ts`
  Worker entrypoint with `fetch` and `scheduled`.
- `worker/app.ts`
  Hono routes for API and SPA asset fallback.
- `worker/storage.ts`
  KV/R2-backed snapshot and flight-detail cache logic.

## Local development

Run the frontend and Worker together:

```bash
npm run dev
```

- Vite runs on port `5173`
- Wrangler local Worker runs on port `8787`
- Vite proxies `/api/*` to the Worker

## Required Cloudflare resources

The Worker expects:

- one KV namespace bound as `FLIGHT_CACHE`
- one R2 bucket bound as `SNAPSHOT_ARCHIVE`
- one D1 database bound as `ROUTE_DB` for live route indexing
- static assets bound as `ASSETS`

## Suggested provisioning

Create the R2 bucket if it does not already exist:

```bash
wrangler r2 bucket create sidecar-flight-monitor-snapshots
```

For KV, Wrangler can usually create and backfill the namespace binding from `wrangler.jsonc`, but if you want to do it explicitly:

```bash
wrangler kv namespace create FLIGHT_CACHE
```

Then copy the returned namespace id into `wrangler.jsonc` if Wrangler does not write it back automatically.

Create the D1 database for route intelligence:

```bash
wrangler d1 create sidecar-flight-monitor-routes
```

Then add the returned `database_id` into the commented `d1_databases` block in `wrangler.jsonc`.

Important:

- the D1 database resource itself must be created manually
- the Worker will auto-bootstrap its table/index schema on first use with `CREATE TABLE IF NOT EXISTS`
- you do not need a separate SQL migration step for the initial schema unless you want stricter migration control later

## Deploy

```bash
npm run deploy:worker
```

This will:

1. build the frontend into `dist/`
2. upload static assets
3. deploy the Hono Worker

## Runtime model

- `scheduled` runs every minute and refreshes the latest full flight snapshot
- latest snapshot is cached in KV
- each full snapshot can also be archived to R2
- individual flight details are cached in KV on first click
- D1 stores the current enriched live-flight index and route profiles used for complex route filters

## Config vars

`wrangler.jsonc` includes:

- `UPSTREAM_BASE_URL`
- `UPSTREAM_PROXY_BASE_URL`
- `SNAPSHOT_TTL_SECONDS`
- `DETAIL_TTL_SECONDS`
- `SEARCH_TTL_SECONDS`
- `ENABLE_SNAPSHOT_ARCHIVE`
- `LIVE_ROUTE_ENRICH_BATCH_SIZE`
- `LIVE_ROUTE_SUCCESS_REVALIDATE_SECONDS`
- `LIVE_ROUTE_ERROR_BACKOFF_SECONDS`

These can stay in config unless you later move any upstream values into Worker secrets.
