import { Hono } from "hono";
import { cors } from "hono/cors";
import { queryLiveRoutes } from "./routeDb.js";
import {
  getCachedRouteDetail,
  getFlightDetail,
  getFlightSearch,
  getLatestSnapshot,
  getRouteCatalog,
  getTopAirportBoards
} from "./storage.js";
import type { WorkerEnv } from "./bindings.js";

const app = new Hono<WorkerEnv>();

app.use("/api/*", cors());

app.get("/api/health", (c) => {
  return c.json({
    ok: true,
    service: "sidecar-flight-monitor-worker",
    now: new Date().toISOString()
  });
});

app.get("/api/states/all", async (c) => {
  const payload = await getLatestSnapshot(c.env);
  c.header("Cache-Control", "public, max-age=15, stale-while-revalidate=45");
  return c.json(payload);
});

app.get("/api/fr24/search", async (c) => {
  const query = c.req.query("query")?.trim() ?? "";
  const limit = Math.max(1, Math.min(12, Number(c.req.query("limit") ?? "8") || 8));

  if (!query) {
    return c.json({ error: "query is required" }, 400);
  }

  const payload = await getFlightSearch(c.env, query, limit);
  c.header("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
  return c.json(payload);
});

app.get("/api/fr24/detail", async (c) => {
  const flight = c.req.query("flight")?.trim() ?? "";
  const version = c.req.query("version")?.trim() || "1.5";

  if (!flight) {
    return c.json({ error: "flight is required" }, 400);
  }

  const payload = await getFlightDetail(c.env, flight, version);
  c.header("Cache-Control", "public, max-age=30, stale-while-revalidate=90");
  return c.json(payload);
});

app.get("/api/boards/top-airports", async (c) => {
  const payload = await getTopAirportBoards(c.env);
  c.header("Cache-Control", "public, max-age=60, stale-while-revalidate=240");
  return c.json(payload);
});

app.get("/api/routes/catalog", async (c) => {
  const limit = Math.max(1, Math.min(250, Number(c.req.query("limit") ?? "80") || 80));
  const payload = await getRouteCatalog(c.env, {
    airline: c.req.query("airline")?.trim(),
    aircraft: c.req.query("aircraft")?.trim(),
    haul: c.req.query("haul")?.trim(),
    origin: c.req.query("origin")?.trim(),
    destination: c.req.query("destination")?.trim(),
    country: c.req.query("country")?.trim(),
    limit
  });

  c.header("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
  return c.json(payload);
});

app.get("/api/routes/detail", async (c) => {
  const route = c.req.query("route")?.trim() ?? "";

  if (!route) {
    return c.json({ error: "route is required" }, 400);
  }

  const payload = await getCachedRouteDetail(c.env, route);

  if (!payload) {
    return c.json({ error: "route detail not found in cache" }, 404);
  }

  c.header("Cache-Control", "public, max-age=120, stale-while-revalidate=600");
  return c.json(payload);
});

app.get("/api/live-routes", async (c) => {
  const minDistanceKm = c.req.query("minDistanceKm");
  const maxDistanceKm = c.req.query("maxDistanceKm");
  const limit = Math.max(1, Math.min(500, Number(c.req.query("limit") ?? "250") || 250));
  const onlyAirborne = c.req.query("onlyAirborne");

  const payload = await queryLiveRoutes(c.env, {
    airline: c.req.query("airline")?.trim(),
    aircraft: c.req.query("aircraft")?.trim(),
    origin: c.req.query("origin")?.trim(),
    destination: c.req.query("destination")?.trim(),
    haul: c.req.query("haul")?.trim(),
    country: c.req.query("country")?.trim(),
    minDistanceKm: minDistanceKm ? Number(minDistanceKm) : undefined,
    maxDistanceKm: maxDistanceKm ? Number(maxDistanceKm) : undefined,
    onlyAirborne: onlyAirborne ? onlyAirborne !== "false" : true,
    limit
  });

  c.header("Cache-Control", "public, max-age=20, stale-while-revalidate=40");
  return c.json(payload);
});

app.notFound(async (c) => {
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    return c.json({ error: "not found" }, 404);
  }

  const assetResponse = await c.env.ASSETS.fetch(c.req.raw);

  if (assetResponse.status !== 404) {
    return assetResponse;
  }

  const url = new URL(c.req.url);
  url.pathname = "/index.html";
  return c.env.ASSETS.fetch(new Request(url.toString(), c.req.raw));
});

app.onError((error, c) => {
  console.error(error);
  return c.json(
    {
      error: error instanceof Error ? error.message : "unknown worker error"
    },
    502
  );
});

export default app;
