import app from "./app.js";
import { refreshLatestSnapshot } from "./storage.js";
import type { WorkerBindings } from "./bindings.js";

export default {
  fetch: app.fetch,
  scheduled(controller: ScheduledController, env: WorkerBindings, ctx: ExecutionContext) {
    ctx.waitUntil(refreshLatestSnapshot(env));
  }
};
