import app from "./app.js";
import { refreshLiveRouteIndex } from "./routeDb.js";
import { refreshLatestSnapshot, refreshRouteCatalog, refreshTopAirportBoards } from "./storage.js";
import type { WorkerBindings } from "./bindings.js";

export default {
  fetch: app.fetch,
  scheduled(controller: ScheduledController, env: WorkerBindings, ctx: ExecutionContext) {
    void controller.cron;
    ctx.waitUntil(
      Promise.allSettled([
        refreshLatestSnapshot(env),
        refreshTopAirportBoards(env),
        refreshRouteCatalog(env),
        refreshLiveRouteIndex(env)
      ]).then(() => undefined)
    );
  }
};
