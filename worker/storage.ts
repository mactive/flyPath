import { KV_KEYS, envFlag, envNumber } from "./constants.js";
import type { WorkerBindings } from "./bindings.js";
import { upstream } from "./upstream.js";

function archiveKey(now = new Date()) {
  const iso = now.toISOString();
  const [date, time] = iso.split("T");
  const [year, month, day] = date.split("-");
  const minute = time.slice(0, 5).replace(":", "/");
  return `snapshots/${year}/${month}/${day}/${minute}.json`;
}

export async function refreshLatestSnapshot(env: WorkerBindings) {
  const payload = await upstream.fetchStatesAll(env);
  const snapshotTtl = envNumber(env.SNAPSHOT_TTL_SECONDS, 90);
  const body = JSON.stringify(payload);
  const archivedAt = new Date().toISOString();
  const objectKey = archiveKey();

  await env.FLIGHT_CACHE.put(KV_KEYS.latestSnapshot, body, {
    expirationTtl: snapshotTtl
  });

  await env.FLIGHT_CACHE.put(
    KV_KEYS.latestSnapshotMeta,
    JSON.stringify({
      archivedAt,
      objectKey
    }),
    {
      expirationTtl: snapshotTtl
    }
  );

  if (envFlag(env.ENABLE_SNAPSHOT_ARCHIVE, true)) {
    await env.SNAPSHOT_ARCHIVE.put(objectKey, body, {
      httpMetadata: {
        contentType: "application/json"
      }
    });
  }

  return payload;
}

export async function getLatestSnapshot(env: WorkerBindings) {
  const cached = await env.FLIGHT_CACHE.get(KV_KEYS.latestSnapshot, "json");

  if (cached) {
    return cached;
  }

  return refreshLatestSnapshot(env);
}

export async function getFlightSearch(env: WorkerBindings, query: string, limit: number) {
  const key = KV_KEYS.search(query, limit);
  const cached = await env.FLIGHT_CACHE.get(key, "json");

  if (cached) {
    return cached;
  }

  const payload = await upstream.searchFlights(env, query, limit);
  await env.FLIGHT_CACHE.put(key, JSON.stringify(payload), {
    expirationTtl: envNumber(env.SEARCH_TTL_SECONDS, 300)
  });
  return payload;
}

export async function getFlightDetail(env: WorkerBindings, flightId: string, version: string) {
  const key = KV_KEYS.detail(flightId, version);
  const cached = await env.FLIGHT_CACHE.get(key, "json");

  if (cached) {
    return cached;
  }

  const payload = await upstream.fetchFlightDetail(env, flightId, version);
  await env.FLIGHT_CACHE.put(key, JSON.stringify(payload), {
    expirationTtl: envNumber(env.DETAIL_TTL_SECONDS, 1800)
  });
  return payload;
}
