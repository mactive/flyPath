import { serve } from "@hono/node-server";
import app from "./app.js";
import { STATES_ALL_CACHE_KEY } from "./cacheKeys.js";
import { memoryCache } from "./cache.js";
import { provider } from "./provider.js";

const port = Number(process.env.PORT ?? "8787");
const hostname = process.env.HOST ?? "127.0.0.1";
const FULL_SNAPSHOT_REFRESH_MS = 60_000;

async function refreshStatesCache() {
  const snapshot = await provider.fetchStatesAll();
  memoryCache.put(STATES_ALL_CACHE_KEY, snapshot, 75_000);
}

const server = serve({
  fetch: app.fetch,
  port,
  hostname
});

console.log(`SideCar Flight API listening on http://${hostname}:${port}`);

void refreshStatesCache().catch((error) => {
  console.error("Initial full snapshot refresh failed", error);
});

const snapshotTimer = setInterval(() => {
  void refreshStatesCache().catch((error) => {
    console.error("Scheduled full snapshot refresh failed", error);
  });
}, FULL_SNAPSHOT_REFRESH_MS);

process.on("SIGINT", () => {
  clearInterval(snapshotTimer);
  server.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  clearInterval(snapshotTimer);
  server.close((error) => {
    if (error) {
      console.error(error);
      process.exit(1);
    }

    process.exit(0);
  });
});
