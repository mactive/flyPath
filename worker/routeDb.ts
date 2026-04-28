import type { WorkerBindings } from "./bindings.js";
import { envNumber } from "./constants.js";
import { buildRouteDetail, type CachedRouteDetail, type RawFlightDetailPayload } from "./routeCache.js";
import { upstream } from "./upstream.js";

type RawState = [
  string,
  string | null,
  string | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  boolean,
  number | null,
  number | null,
  number | null,
  unknown,
  number | null,
  string | null,
  boolean,
  number
];

interface RawAllFlightsResponse {
  time: number;
  states: RawState[];
}

interface RawSearchResult {
  id: string;
  type: string;
  label: string;
  detail?: {
    callsign?: string;
    flight?: string;
  };
}

interface RawSearchResponse {
  results?: RawSearchResult[];
}

interface LiveFlightRow {
  state_id: string;
  callsign: string;
  country: string;
  latitude: number;
  longitude: number;
  altitude_ft: number;
  ground_speed_kts: number;
  heading: number;
  vertical_rate_fpm: number;
  on_ground: number;
  squawk: string | null;
  last_contact: number;
  snapshot_time: number;
  status_label: string;
  tone: string;
  route_key: string | null;
  flight_number: string | null;
  airline_name: string | null;
  airline_iata: string | null;
  airline_icao: string | null;
  aircraft_model: string | null;
  registration: string | null;
  fr24_flight_id: string | null;
  status_text: string | null;
  detail_live: number | null;
  scheduled_departure: number | null;
  scheduled_arrival: number | null;
  origin_code: string | null;
  destination_code: string | null;
  distance_km: number | null;
  haul_bucket: string | null;
  last_enriched_at: string | null;
  next_enrich_after: string | null;
  enrich_attempts: number;
  last_enrich_error: string | null;
}

export interface LiveRouteFilters {
  airline?: string;
  aircraft?: string;
  origin?: string;
  destination?: string;
  haul?: string;
  country?: string;
  minDistanceKm?: number;
  maxDistanceKm?: number;
  onlyAirborne?: boolean;
  limit?: number;
}

export interface LiveRouteQueryResponse {
  updatedAt: string;
  coverage: {
    activeFlights: number;
    enrichedFlights: number;
    pendingEnrichment: number;
  };
  flights: Array<{
    id: string;
    callsign: string;
    country: string;
    latitude: number;
    longitude: number;
    altitudeFt: number;
    groundSpeedKts: number;
    heading: number;
    verticalRateFpm: number;
    onGround: boolean;
    squawk: string | null;
    lastContact: number;
    statusLabel: string;
    tone: "ground" | "climbing" | "descending" | "cruise" | "approach";
    flightNumber: string | null;
    airlineName: string | null;
    airlineIata: string | null;
    airlineIcao: string | null;
    aircraftModel: string | null;
    registration: string | null;
    routeKey: string | null;
    originCode: string | null;
    destinationCode: string | null;
    distanceKm: number | null;
    haulBucket: string | null;
    statusText: string | null;
    lastEnrichedAt: string | null;
  }>;
  routes: Array<{
    routeKey: string;
    routeLabel: string;
    originCode: string;
    originName: string;
    destinationCode: string;
    destinationName: string;
    distanceKm: number;
    haulBucket: string;
    activeFlights: number;
    airlines: string[];
    aircraftModels: string[];
    lastSeenAt: number;
  }>;
}

const ROUTE_DB_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS route_profiles (
    route_key TEXT PRIMARY KEY,
    route_label TEXT NOT NULL,
    origin_code TEXT NOT NULL,
    origin_iata TEXT NOT NULL,
    origin_icao TEXT NOT NULL,
    origin_name TEXT NOT NULL,
    origin_city TEXT,
    origin_country TEXT,
    origin_lat REAL NOT NULL,
    origin_lng REAL NOT NULL,
    destination_code TEXT NOT NULL,
    destination_iata TEXT NOT NULL,
    destination_icao TEXT NOT NULL,
    destination_name TEXT NOT NULL,
    destination_city TEXT,
    destination_country TEXT,
    destination_lat REAL NOT NULL,
    destination_lng REAL NOT NULL,
    distance_km INTEGER NOT NULL,
    haul_bucket TEXT NOT NULL,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS live_flights (
    state_id TEXT PRIMARY KEY,
    callsign TEXT NOT NULL,
    country TEXT NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    altitude_ft INTEGER NOT NULL,
    ground_speed_kts INTEGER NOT NULL,
    heading INTEGER NOT NULL,
    vertical_rate_fpm INTEGER NOT NULL,
    on_ground INTEGER NOT NULL,
    squawk TEXT,
    last_contact INTEGER NOT NULL,
    snapshot_time INTEGER NOT NULL,
    status_label TEXT NOT NULL,
    tone TEXT NOT NULL,
    route_key TEXT,
    flight_number TEXT,
    airline_name TEXT,
    airline_iata TEXT,
    airline_icao TEXT,
    aircraft_model TEXT,
    registration TEXT,
    fr24_flight_id TEXT,
    status_text TEXT,
    detail_live INTEGER,
    scheduled_departure INTEGER,
    scheduled_arrival INTEGER,
    origin_code TEXT,
    destination_code TEXT,
    distance_km INTEGER,
    haul_bucket TEXT,
    last_enriched_at TEXT,
    next_enrich_after TEXT,
    enrich_attempts INTEGER NOT NULL DEFAULT 0,
    last_enrich_error TEXT,
    FOREIGN KEY(route_key) REFERENCES route_profiles(route_key)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_live_flights_snapshot_time ON live_flights(snapshot_time)`,
  `CREATE INDEX IF NOT EXISTS idx_live_flights_enrich_due ON live_flights(next_enrich_after, on_ground, snapshot_time)`,
  `CREATE INDEX IF NOT EXISTS idx_live_flights_airline_name ON live_flights(airline_name)`,
  `CREATE INDEX IF NOT EXISTS idx_live_flights_airline_iata ON live_flights(airline_iata)`,
  `CREATE INDEX IF NOT EXISTS idx_live_flights_aircraft_model ON live_flights(aircraft_model)`,
  `CREATE INDEX IF NOT EXISTS idx_live_flights_origin_code ON live_flights(origin_code)`,
  `CREATE INDEX IF NOT EXISTS idx_live_flights_destination_code ON live_flights(destination_code)`,
  `CREATE INDEX IF NOT EXISTS idx_live_flights_distance_km ON live_flights(distance_km)`,
  `CREATE INDEX IF NOT EXISTS idx_live_flights_route_key ON live_flights(route_key)`
] as const;

let schemaReady: Promise<void> | null = null;

function getRouteDb(env: WorkerBindings): D1Database {
  if (!env.ROUTE_DB) {
    throw new Error("ROUTE_DB binding is not configured. Create and bind a Cloudflare D1 database first.");
  }

  return env.ROUTE_DB;
}

async function ensureRouteDbSchema(env: WorkerBindings) {
  if (!schemaReady) {
    const db = getRouteDb(env);
    schemaReady = (async () => {
      for (const statement of ROUTE_DB_SCHEMA_STATEMENTS) {
        await db.exec(statement);
      }
    })();
  }

  return schemaReady;
}

function normalizeCallsign(value: string | null | undefined): string {
  return value?.trim() || "UNTRACKED";
}

function metersToFeet(value: number | null | undefined): number {
  return value ? Math.round(value * 3.28084) : 0;
}

function metersPerSecondToKnots(value: number | null | undefined): number {
  return value ? Math.round(value * 1.94384) : 0;
}

function metersPerSecondToFeetPerMinute(value: number | null | undefined): number {
  return value ? Math.round(value * 196.850394) : 0;
}

function deriveTone(onGround: boolean, altitudeFt: number, verticalRateFpm: number) {
  if (onGround) {
    return "ground" as const;
  }

  if (verticalRateFpm > 900) {
    return "climbing" as const;
  }

  if (verticalRateFpm < -900) {
    return "descending" as const;
  }

  if (altitudeFt < 8000) {
    return "approach" as const;
  }

  return "cruise" as const;
}

function deriveStatusLabel(tone: ReturnType<typeof deriveTone>) {
  switch (tone) {
    case "ground":
      return "On ground";
    case "climbing":
      return "Climbing";
    case "descending":
      return "Descending";
    case "approach":
      return "Approach";
    default:
      return "Cruise";
  }
}

function normalizeLiveState(state: RawState, snapshotTime: number) {
  const altitudeFt = metersToFeet(state[13] ?? state[7]);
  const verticalRateFpm = metersPerSecondToFeetPerMinute(state[11]);
  const tone = deriveTone(state[8], altitudeFt, verticalRateFpm);

  return {
    stateId: state[0],
    callsign: normalizeCallsign(state[1]),
    country: state[2] || "Unknown",
    latitude: state[6] ?? 0,
    longitude: state[5] ?? 0,
    altitudeFt,
    groundSpeedKts: metersPerSecondToKnots(state[9]),
    heading: Math.round(state[10] ?? 0),
    verticalRateFpm,
    onGround: state[8],
    squawk: state[14],
    lastContact: state[4] ?? snapshotTime,
    snapshotTime,
    tone,
    statusLabel: deriveStatusLabel(tone)
  };
}

function pickBestSearchResult(callsign: string, payload: RawSearchResponse): RawSearchResult | null {
  const normalizedCallsign = callsign.trim().toUpperCase();
  const liveResults = (payload.results ?? []).filter((result) => result.type === "live");

  if (liveResults.length === 0) {
    return payload.results?.[0] ?? null;
  }

  const exact = liveResults.find((result) => result.detail?.callsign?.trim().toUpperCase() === normalizedCallsign);
  if (exact) {
    return exact;
  }

  const prefix = liveResults.find((result) => (result.detail?.callsign ?? "").trim().toUpperCase().includes(normalizedCallsign));
  return prefix ?? liveResults[0] ?? null;
}

function isoAfterSeconds(seconds: number) {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function backoffSeconds(attempts: number, baseSeconds: number, maxSeconds: number) {
  return Math.min(baseSeconds * 2 ** Math.max(0, attempts - 1), maxSeconds);
}

async function upsertRouteProfile(db: D1Database, route: CachedRouteDetail) {
  await db
    .prepare(
      `
      INSERT INTO route_profiles (
        route_key, route_label,
        origin_code, origin_iata, origin_icao, origin_name, origin_city, origin_country, origin_lat, origin_lng,
        destination_code, destination_iata, destination_icao, destination_name, destination_city, destination_country, destination_lat, destination_lng,
        distance_km, haul_bucket, first_seen_at, last_seen_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(route_key) DO UPDATE SET
        route_label = excluded.route_label,
        origin_code = excluded.origin_code,
        origin_iata = excluded.origin_iata,
        origin_icao = excluded.origin_icao,
        origin_name = excluded.origin_name,
        origin_city = excluded.origin_city,
        origin_country = excluded.origin_country,
        origin_lat = excluded.origin_lat,
        origin_lng = excluded.origin_lng,
        destination_code = excluded.destination_code,
        destination_iata = excluded.destination_iata,
        destination_icao = excluded.destination_icao,
        destination_name = excluded.destination_name,
        destination_city = excluded.destination_city,
        destination_country = excluded.destination_country,
        destination_lat = excluded.destination_lat,
        destination_lng = excluded.destination_lng,
        distance_km = excluded.distance_km,
        haul_bucket = excluded.haul_bucket,
        last_seen_at = excluded.last_seen_at
      `
    )
    .bind(
      route.routeKey,
      route.routeLabel,
      route.origin.code,
      route.origin.iata,
      route.origin.icao,
      route.origin.name,
      route.origin.city ?? null,
      route.origin.country ?? null,
      route.origin.latitude,
      route.origin.longitude,
      route.destination.code,
      route.destination.iata,
      route.destination.icao,
      route.destination.name,
      route.destination.city ?? null,
      route.destination.country ?? null,
      route.destination.latitude,
      route.destination.longitude,
      route.distanceKm,
      route.haulBucket,
      route.firstSeenAt,
      route.lastSeenAt
    )
    .run();
}

async function upsertLiveStates(env: WorkerBindings, payload: RawAllFlightsResponse) {
  const db = getRouteDb(env);
  await ensureRouteDbSchema(env);

  const normalized = payload.states
    .filter((state) => state[5] !== null && state[6] !== null)
    .map((state) => normalizeLiveState(state, payload.time));

  const chunkSize = 100;
  for (let index = 0; index < normalized.length; index += chunkSize) {
    const chunk = normalized.slice(index, index + chunkSize);
    const statements = chunk.map((flight) =>
      db
        .prepare(
          `
          INSERT INTO live_flights (
            state_id, callsign, country, latitude, longitude, altitude_ft, ground_speed_kts, heading, vertical_rate_fpm,
            on_ground, squawk, last_contact, snapshot_time, status_label, tone
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(state_id) DO UPDATE SET
            callsign = excluded.callsign,
            country = excluded.country,
            latitude = excluded.latitude,
            longitude = excluded.longitude,
            altitude_ft = excluded.altitude_ft,
            ground_speed_kts = excluded.ground_speed_kts,
            heading = excluded.heading,
            vertical_rate_fpm = excluded.vertical_rate_fpm,
            on_ground = excluded.on_ground,
            squawk = excluded.squawk,
            last_contact = excluded.last_contact,
            snapshot_time = excluded.snapshot_time,
            status_label = excluded.status_label,
            tone = excluded.tone
          `
        )
        .bind(
          flight.stateId,
          flight.callsign,
          flight.country,
          flight.latitude,
          flight.longitude,
          flight.altitudeFt,
          flight.groundSpeedKts,
          flight.heading,
          flight.verticalRateFpm,
          flight.onGround ? 1 : 0,
          flight.squawk,
          flight.lastContact,
          flight.snapshotTime,
          flight.statusLabel,
          flight.tone
        )
    );

    await db.batch(statements);
  }

  const staleThreshold = payload.time - envNumber(env.LIVE_ROUTE_STALE_SECONDS, 10 * 60);
  await db.prepare(`DELETE FROM live_flights WHERE snapshot_time < ?`).bind(staleThreshold).run();

  return normalized.length;
}

async function markEnrichmentFailure(
  db: D1Database,
  stateId: string,
  attempts: number,
  errorMessage: string,
  env: WorkerBindings
) {
  const backoff = backoffSeconds(
    attempts + 1,
    envNumber(env.LIVE_ROUTE_ERROR_BACKOFF_SECONDS, 120),
    envNumber(env.LIVE_ROUTE_MAX_BACKOFF_SECONDS, 30 * 60)
  );

  await db
    .prepare(
      `
      UPDATE live_flights
      SET enrich_attempts = ?,
          last_enrich_error = ?,
          next_enrich_after = ?
      WHERE state_id = ?
      `
    )
    .bind(attempts + 1, errorMessage.slice(0, 500), isoAfterSeconds(backoff), stateId)
    .run();
}

async function markEnrichmentSuccess(
  db: D1Database,
  row: LiveFlightRow,
  detailPayload: RawFlightDetailPayload,
  route: CachedRouteDetail,
  fr24FlightId: string,
  env: WorkerBindings
) {
  const revalidateAfter = isoAfterSeconds(envNumber(env.LIVE_ROUTE_SUCCESS_REVALIDATE_SECONDS, 12 * 60));
  const nowIso = new Date().toISOString();

  await upsertRouteProfile(db, route);

  await db
    .prepare(
      `
      UPDATE live_flights
      SET route_key = ?,
          flight_number = ?,
          airline_name = ?,
          airline_iata = ?,
          airline_icao = ?,
          aircraft_model = ?,
          registration = ?,
          fr24_flight_id = ?,
          status_text = ?,
          detail_live = ?,
          scheduled_departure = ?,
          scheduled_arrival = ?,
          origin_code = ?,
          destination_code = ?,
          distance_km = ?,
          haul_bucket = ?,
          last_enriched_at = ?,
          next_enrich_after = ?,
          enrich_attempts = 0,
          last_enrich_error = NULL
      WHERE state_id = ?
      `
    )
    .bind(
      route.routeKey,
      detailPayload.identification?.number?.default?.trim() || detailPayload.identification?.callsign?.trim() || row.callsign,
      detailPayload.airline?.name?.trim() || route.lastFlight.airlineName,
      detailPayload.airline?.code?.iata?.trim().toUpperCase() || null,
      detailPayload.airline?.code?.icao?.trim().toUpperCase() || null,
      detailPayload.aircraft?.model?.text?.trim() || null,
      detailPayload.aircraft?.registration ?? null,
      fr24FlightId,
      detailPayload.status?.text?.trim() || route.lastFlight.statusText,
      detailPayload.status?.live ? 1 : 0,
      detailPayload.time?.scheduled?.departure ?? null,
      detailPayload.time?.scheduled?.arrival ?? null,
      route.origin.code,
      route.destination.code,
      route.distanceKm,
      route.haulBucket,
      nowIso,
      revalidateAfter,
      row.state_id
    )
    .run();
}

async function enrichSingleFlight(db: D1Database, row: LiveFlightRow, env: WorkerBindings) {
  try {
    const searchPayload = (await upstream.searchFlights(env, row.callsign, 5)) as RawSearchResponse;
    const bestMatch = pickBestSearchResult(row.callsign, searchPayload);

    if (!bestMatch?.id) {
      throw new Error("No live search result was returned");
    }

    const detailPayload = (await upstream.fetchFlightDetail(env, bestMatch.id, "1.5")) as RawFlightDetailPayload;
    const route = buildRouteDetail(detailPayload, "1.5");

    if (!route) {
      throw new Error("Flight detail did not produce a usable route profile");
    }

    await markEnrichmentSuccess(db, row, detailPayload, route, bestMatch.id, env);
    return true;
  } catch (error) {
    await markEnrichmentFailure(
      db,
      row.state_id,
      row.enrich_attempts,
      error instanceof Error ? error.message : "unknown enrich error",
      env
    );
    return false;
  }
}

async function processDueEnrichment(env: WorkerBindings) {
  const db = getRouteDb(env);
  await ensureRouteDbSchema(env);

  const limit = envNumber(env.LIVE_ROUTE_ENRICH_BATCH_SIZE, 24);
  const nowIso = new Date().toISOString();
  const candidates = await db
    .prepare(
      `
      SELECT *
      FROM live_flights
      WHERE on_ground = 0
        AND callsign <> 'UNTRACKED'
        AND (next_enrich_after IS NULL OR next_enrich_after <= ?)
      ORDER BY CASE WHEN last_enriched_at IS NULL THEN 0 ELSE 1 END,
               snapshot_time DESC,
               ground_speed_kts DESC
      LIMIT ?
      `
    )
    .bind(nowIso, limit)
    .all<LiveFlightRow>();

  const rows = candidates.results ?? [];
  let succeeded = 0;

  for (const row of rows) {
    const success = await enrichSingleFlight(db, row, env);
    if (success) {
      succeeded += 1;
    }
  }

  return {
    attempted: rows.length,
    succeeded
  };
}

export async function syncLiveRouteIndex(env: WorkerBindings, payload: RawAllFlightsResponse) {
  const indexedFlights = await upsertLiveStates(env, payload);
  const enrichment = await processDueEnrichment(env);

  return {
    indexedFlights,
    ...enrichment
  };
}

export async function refreshLiveRouteIndex(env: WorkerBindings) {
  const payload = (await upstream.fetchStatesAll(env)) as RawAllFlightsResponse;
  return syncLiveRouteIndex(env, payload);
}

function applyTextFilter(
  conditions: string[],
  bindings: Array<string | number>,
  columns: string[],
  value: string | undefined
) {
  const normalized = value?.trim();
  if (!normalized) {
    return;
  }

  const lowered = `%${normalized.toLowerCase()}%`;
  conditions.push(`(${columns.map((column) => `LOWER(${column}) LIKE ?`).join(" OR ")})`);
  for (let index = 0; index < columns.length; index += 1) {
    bindings.push(lowered);
  }
}

async function getCoverage(db: D1Database) {
  const result = await db
    .prepare(
      `
      SELECT
        COUNT(*) AS activeFlights,
        SUM(CASE WHEN route_key IS NOT NULL THEN 1 ELSE 0 END) AS enrichedFlights,
        SUM(CASE WHEN on_ground = 0 AND (next_enrich_after IS NULL OR next_enrich_after <= ?) THEN 1 ELSE 0 END) AS pendingEnrichment
      FROM live_flights
      `
    )
    .bind(new Date().toISOString())
    .first<{
      activeFlights: number | null;
      enrichedFlights: number | null;
      pendingEnrichment: number | null;
    }>();

  return {
    activeFlights: Number(result?.activeFlights ?? 0),
    enrichedFlights: Number(result?.enrichedFlights ?? 0),
    pendingEnrichment: Number(result?.pendingEnrichment ?? 0)
  };
}

export async function queryLiveRoutes(env: WorkerBindings, filters: LiveRouteFilters): Promise<LiveRouteQueryResponse> {
  const db = getRouteDb(env);
  await ensureRouteDbSchema(env);

  const conditions = [`live_flights.route_key IS NOT NULL`];
  const bindings: Array<string | number> = [];

  if (filters.onlyAirborne !== false) {
    conditions.push(`live_flights.on_ground = 0`);
  }

  applyTextFilter(conditions, bindings, ["live_flights.airline_name", "live_flights.airline_iata", "live_flights.airline_icao"], filters.airline);
  applyTextFilter(conditions, bindings, ["live_flights.aircraft_model"], filters.aircraft);
  applyTextFilter(conditions, bindings, ["live_flights.origin_code"], filters.origin);
  applyTextFilter(conditions, bindings, ["live_flights.destination_code"], filters.destination);
  applyTextFilter(conditions, bindings, ["live_flights.country", "route_profiles.origin_country", "route_profiles.destination_country"], filters.country);

  if (filters.haul?.trim()) {
    conditions.push(`LOWER(live_flights.haul_bucket) = ?`);
    bindings.push(filters.haul.trim().toLowerCase());
  }

  if (typeof filters.minDistanceKm === "number" && Number.isFinite(filters.minDistanceKm)) {
    conditions.push(`COALESCE(live_flights.distance_km, 0) >= ?`);
    bindings.push(Math.max(0, Math.round(filters.minDistanceKm)));
  }

  if (typeof filters.maxDistanceKm === "number" && Number.isFinite(filters.maxDistanceKm)) {
    conditions.push(`COALESCE(live_flights.distance_km, 0) <= ?`);
    bindings.push(Math.max(0, Math.round(filters.maxDistanceKm)));
  }

  const whereClause = conditions.join(" AND ");
  const limit = Math.max(1, Math.min(500, Math.round(filters.limit ?? 250)));

  const flightsResult = await db
    .prepare(
      `
      SELECT
        live_flights.state_id,
        live_flights.callsign,
        live_flights.country,
        live_flights.latitude,
        live_flights.longitude,
        live_flights.altitude_ft,
        live_flights.ground_speed_kts,
        live_flights.heading,
        live_flights.vertical_rate_fpm,
        live_flights.on_ground,
        live_flights.squawk,
        live_flights.last_contact,
        live_flights.status_label,
        live_flights.tone,
        live_flights.flight_number,
        live_flights.airline_name,
        live_flights.airline_iata,
        live_flights.airline_icao,
        live_flights.aircraft_model,
        live_flights.registration,
        live_flights.route_key,
        live_flights.origin_code,
        live_flights.destination_code,
        live_flights.distance_km,
        live_flights.haul_bucket,
        live_flights.status_text,
        live_flights.last_enriched_at
      FROM live_flights
      LEFT JOIN route_profiles ON route_profiles.route_key = live_flights.route_key
      WHERE ${whereClause}
      ORDER BY live_flights.last_contact DESC
      LIMIT ?
      `
    )
    .bind(...bindings, limit)
    .all<{
      state_id: string;
      callsign: string;
      country: string;
      latitude: number;
      longitude: number;
      altitude_ft: number;
      ground_speed_kts: number;
      heading: number;
      vertical_rate_fpm: number;
      on_ground: number;
      squawk: string | null;
      last_contact: number;
      status_label: string;
      tone: "ground" | "climbing" | "descending" | "cruise" | "approach";
      flight_number: string | null;
      airline_name: string | null;
      airline_iata: string | null;
      airline_icao: string | null;
      aircraft_model: string | null;
      registration: string | null;
      route_key: string | null;
      origin_code: string | null;
      destination_code: string | null;
      distance_km: number | null;
      haul_bucket: string | null;
      status_text: string | null;
      last_enriched_at: string | null;
    }>();

  const routeBindings = [...bindings];
  const routesResult = await db
    .prepare(
      `
      SELECT
        live_flights.route_key,
        route_profiles.route_label,
        route_profiles.origin_code,
        route_profiles.origin_name,
        route_profiles.destination_code,
        route_profiles.destination_name,
        route_profiles.distance_km,
        route_profiles.haul_bucket,
        COUNT(*) AS active_flights,
        GROUP_CONCAT(DISTINCT COALESCE(live_flights.airline_iata, live_flights.airline_name)) AS airlines,
        GROUP_CONCAT(DISTINCT live_flights.aircraft_model) AS aircraft_models,
        MAX(live_flights.last_contact) AS last_seen_at
      FROM live_flights
      INNER JOIN route_profiles ON route_profiles.route_key = live_flights.route_key
      WHERE ${whereClause}
      GROUP BY live_flights.route_key
      ORDER BY active_flights DESC, last_seen_at DESC
      LIMIT 120
      `
    )
    .bind(...routeBindings)
    .all<{
      route_key: string;
      route_label: string;
      origin_code: string;
      origin_name: string;
      destination_code: string;
      destination_name: string;
      distance_km: number;
      haul_bucket: string;
      active_flights: number;
      airlines: string | null;
      aircraft_models: string | null;
      last_seen_at: number;
    }>();

  const coverage = await getCoverage(db);

  return {
    updatedAt: new Date().toISOString(),
    coverage,
    flights: (flightsResult.results ?? []).map((row) => ({
      id: row.state_id,
      callsign: row.callsign,
      country: row.country,
      latitude: row.latitude,
      longitude: row.longitude,
      altitudeFt: row.altitude_ft,
      groundSpeedKts: row.ground_speed_kts,
      heading: row.heading,
      verticalRateFpm: row.vertical_rate_fpm,
      onGround: Boolean(row.on_ground),
      squawk: row.squawk,
      lastContact: row.last_contact,
      statusLabel: row.status_label,
      tone: row.tone,
      flightNumber: row.flight_number,
      airlineName: row.airline_name,
      airlineIata: row.airline_iata,
      airlineIcao: row.airline_icao,
      aircraftModel: row.aircraft_model,
      registration: row.registration,
      routeKey: row.route_key,
      originCode: row.origin_code,
      destinationCode: row.destination_code,
      distanceKm: row.distance_km,
      haulBucket: row.haul_bucket,
      statusText: row.status_text,
      lastEnrichedAt: row.last_enriched_at
    })),
    routes: (routesResult.results ?? []).map((row) => ({
      routeKey: row.route_key,
      routeLabel: row.route_label,
      originCode: row.origin_code,
      originName: row.origin_name,
      destinationCode: row.destination_code,
      destinationName: row.destination_name,
      distanceKm: row.distance_km,
      haulBucket: row.haul_bucket,
      activeFlights: row.active_flights,
      airlines: row.airlines ? row.airlines.split(",").filter(Boolean) : [],
      aircraftModels: row.aircraft_models ? row.aircraft_models.split(",").filter(Boolean) : [],
      lastSeenAt: row.last_seen_at
    }))
  };
}
