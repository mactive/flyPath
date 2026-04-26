import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { memoryCache } from "./cache.js";
import { provider } from "./provider.js";
const app = new Hono();
const distRoot = fileURLToPath(new URL("../dist", import.meta.url));
const hasBuiltClient = existsSync(distRoot);
app.use("/api/*", cors());
app.get("/api/health", (c) => {
    return c.json({
        ok: true,
        service: "sidecar-flight-monitor-api",
        now: new Date().toISOString()
    });
});
app.get("/api/states/all", async (c) => {
    const payload = await memoryCache.remember("states:all", 15_000, () => provider.fetchStatesAll());
    c.header("Cache-Control", "public, max-age=15, stale-while-revalidate=45");
    return c.json(payload);
});
app.get("/api/fr24/search", async (c) => {
    const query = c.req.query("query")?.trim() ?? "";
    const limit = Math.max(1, Math.min(12, Number(c.req.query("limit") ?? "8") || 8));
    if (!query) {
        return c.json({ error: "query is required" }, 400);
    }
    const payload = await memoryCache.remember(`search:${query}:${limit}`, 5 * 60_000, () => provider.searchFlights(query, limit));
    c.header("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    return c.json(payload);
});
app.get("/api/fr24/detail", async (c) => {
    const flight = c.req.query("flight")?.trim() ?? "";
    const version = c.req.query("version")?.trim() || "1.5";
    if (!flight) {
        return c.json({ error: "flight is required" }, 400);
    }
    const payload = await memoryCache.remember(`detail:${flight}:${version}`, 30_000, () => provider.fetchFlightDetail(flight, version));
    c.header("Cache-Control", "public, max-age=30, stale-while-revalidate=90");
    return c.json(payload);
});
app.onError((error, c) => {
    console.error(error);
    return c.json({
        error: error instanceof Error ? error.message : "unknown server error"
    }, 502);
});
if (hasBuiltClient) {
    app.use("/assets/*", serveStatic({
        root: distRoot
    }));
    app.use("*", async (c, next) => {
        if (c.req.path.startsWith("/api/")) {
            await next();
            return;
        }
        return serveStatic({
            root: distRoot,
            rewriteRequestPath: () => "/index.html"
        })(c, next);
    });
}
else {
    app.get("/", (c) => {
        return c.text("Frontend build not found. Run `npm run build` for production assets or use `npm run dev` during development.", 404);
    });
}
export default app;
