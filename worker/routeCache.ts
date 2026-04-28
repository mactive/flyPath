export type RouteHaulBucket = "short" | "medium" | "long" | "ultra";

interface RawAirport {
  name?: string;
  code?: {
    iata?: string;
    icao?: string;
  };
  position?: {
    latitude?: number;
    longitude?: number;
    country?: {
      name?: string;
    };
    region?: {
      city?: string;
    };
  };
}

interface RawTrailPoint {
  lat?: number;
  lng?: number;
}

export interface RawFlightDetailPayload {
  identification?: {
    id?: string;
    number?: {
      default?: string;
    };
    callsign?: string;
  };
  status?: {
    live?: boolean;
    text?: string;
  };
  airline?: {
    name?: string;
    code?: {
      iata?: string;
      icao?: string;
    };
  };
  aircraft?: {
    model?: {
      text?: string;
    };
    registration?: string;
  };
  airport?: {
    origin?: RawAirport;
    destination?: RawAirport;
  };
  time?: {
    scheduled?: {
      departure?: number;
      arrival?: number;
    };
  };
  trail?: RawTrailPoint[];
}

export interface RouteEndpoint {
  code: string;
  iata: string;
  icao: string;
  name: string;
  city?: string;
  country?: string;
  latitude: number;
  longitude: number;
}

export interface RouteAirlineCount {
  key: string;
  name: string;
  iata?: string;
  icao?: string;
  count: number;
}

export interface RouteAircraftCount {
  key: string;
  model: string;
  count: number;
}

export interface RouteSampleFlight {
  flightId: string;
  flightNumber: string;
  callsign: string;
  statusText: string;
  airlineName: string;
  aircraftModel?: string;
  live: boolean;
  lastSeenAt: string;
}

export interface CachedRouteDetail {
  routeKey: string;
  routeLabel: string;
  detailVersion: string;
  origin: RouteEndpoint;
  destination: RouteEndpoint;
  distanceKm: number;
  haulBucket: RouteHaulBucket;
  observationCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  airlines: RouteAirlineCount[];
  aircraftModels: RouteAircraftCount[];
  sampleFlights: RouteSampleFlight[];
  lastFlight: {
    flightId: string;
    flightNumber: string;
    callsign: string;
    statusText: string;
    airlineName: string;
    aircraftModel?: string;
    scheduledDeparture?: number;
    scheduledArrival?: number;
    trailPointCount: number;
    live: boolean;
  };
}

export interface RouteCatalogFacet {
  value: string;
  label: string;
  count: number;
}

export interface RouteCatalogEntry {
  routeKey: string;
  routeLabel: string;
  origin: RouteEndpoint;
  destination: RouteEndpoint;
  distanceKm: number;
  haulBucket: RouteHaulBucket;
  observationCount: number;
  lastSeenAt: string;
  airlines: RouteCatalogFacet[];
  aircraftModels: RouteCatalogFacet[];
  sampleFlights: Array<Pick<RouteSampleFlight, "flightId" | "flightNumber" | "callsign" | "statusText" | "lastSeenAt">>;
}

export interface RouteCatalogSnapshot {
  updatedAt: string;
  totalRoutes: number;
  truncated: boolean;
  routes: RouteCatalogEntry[];
  filters: {
    airlines: RouteCatalogFacet[];
    aircraftModels: RouteCatalogFacet[];
    haulBuckets: RouteCatalogFacet[];
    originAirports: RouteCatalogFacet[];
    destinationAirports: RouteCatalogFacet[];
    countries: RouteCatalogFacet[];
  };
}

export interface RouteCatalogFilters {
  airline?: string;
  aircraft?: string;
  haul?: string;
  origin?: string;
  destination?: string;
  country?: string;
  limit?: number;
}

function normalizeText(value: string | undefined | null): string {
  return (value ?? "").trim().toLowerCase();
}

function isMeaningfulAirportCode(value: string | undefined): boolean {
  return Boolean(value && value !== "---");
}

function pickAirportCode(airport: RawAirport | undefined): string {
  const iata = airport?.code?.iata?.trim().toUpperCase();
  if (isMeaningfulAirportCode(iata)) {
    return iata!;
  }

  const icao = airport?.code?.icao?.trim().toUpperCase();
  if (isMeaningfulAirportCode(icao)) {
    return icao!;
  }

  const fallbackName = airport?.name?.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-");
  return fallbackName || "UNKNOWN";
}

function normalizeAirport(airport?: RawAirport): RouteEndpoint {
  const iata = airport?.code?.iata?.trim().toUpperCase() || "---";
  const icao = airport?.code?.icao?.trim().toUpperCase() || "---";

  return {
    code: pickAirportCode(airport),
    iata,
    icao,
    name: airport?.name?.trim() || "Unknown airport",
    city: airport?.position?.region?.city?.trim(),
    country: airport?.position?.country?.name?.trim(),
    latitude: Number.isFinite(airport?.position?.latitude) ? airport?.position?.latitude ?? 0 : 0,
    longitude: Number.isFinite(airport?.position?.longitude) ? airport?.position?.longitude ?? 0 : 0
  };
}

function hasCoordinates(airport: RouteEndpoint): boolean {
  return Number.isFinite(airport.latitude) && Number.isFinite(airport.longitude) && airport.latitude !== 0 && airport.longitude !== 0;
}

function haversineDistanceKm(origin: RouteEndpoint, destination: RouteEndpoint): number {
  if (!hasCoordinates(origin) || !hasCoordinates(destination)) {
    return 0;
  }

  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRadians(destination.latitude - origin.latitude);
  const dLng = toRadians(destination.longitude - origin.longitude);
  const lat1 = toRadians(origin.latitude);
  const lat2 = toRadians(destination.latitude);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);

  return Math.round(earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function classifyHaul(distanceKm: number): RouteHaulBucket {
  if (distanceKm < 1500) {
    return "short";
  }

  if (distanceKm < 4000) {
    return "medium";
  }

  if (distanceKm < 9000) {
    return "long";
  }

  return "ultra";
}

function buildRouteLabel(origin: RouteEndpoint, destination: RouteEndpoint): string {
  return `${origin.code} -> ${destination.code}`;
}

function buildAirlineKey(payload: RawFlightDetailPayload): string {
  const iata = payload.airline?.code?.iata?.trim().toUpperCase();
  if (iata) {
    return iata;
  }

  const icao = payload.airline?.code?.icao?.trim().toUpperCase();
  if (icao) {
    return icao;
  }

  const name = payload.airline?.name?.trim().toUpperCase();
  return name || "UNKNOWN";
}

function buildAircraftKey(model: string): string {
  return model.trim().toUpperCase();
}

function buildFlightIdentityKey(flight: Pick<RouteSampleFlight, "flightId" | "callsign" | "flightNumber">): string {
  const flightId = flight.flightId.trim();
  if (flightId) {
    return flightId;
  }

  const callsign = flight.callsign.trim();
  if (callsign) {
    return callsign;
  }

  return flight.flightNumber.trim();
}

function sortCountDescending<T extends { count: number }>(items: T[]): T[] {
  return [...items].sort((left, right) => {
    if (right.count !== left.count) {
      return right.count - left.count;
    }

    return JSON.stringify(left).localeCompare(JSON.stringify(right));
  });
}

function incrementFacetCount(map: Map<string, RouteCatalogFacet>, value: string, label = value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return;
  }

  const current = map.get(normalized);
  if (current) {
    current.count += 1;
    return;
  }

  map.set(normalized, {
    value,
    label,
    count: 1
  });
}

function mapToFacets(map: Map<string, RouteCatalogFacet>): RouteCatalogFacet[] {
  return [...map.values()].sort((left, right) => {
    if (right.count !== left.count) {
      return right.count - left.count;
    }

    return left.label.localeCompare(right.label);
  });
}

function trimSamples(samples: RouteSampleFlight[]): RouteSampleFlight[] {
  return [...samples]
    .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt))
    .slice(0, 6);
}

function isUnknownRoute(detail: CachedRouteDetail): boolean {
  return detail.origin.code === "UNKNOWN" || detail.destination.code === "UNKNOWN";
}

export function buildRouteDetail(
  payload: RawFlightDetailPayload,
  version: string,
  nowIso = new Date().toISOString()
): CachedRouteDetail | null {
  const origin = normalizeAirport(payload.airport?.origin);
  const destination = normalizeAirport(payload.airport?.destination);

  if (origin.code === "UNKNOWN" || destination.code === "UNKNOWN") {
    return null;
  }

  const distanceKm = haversineDistanceKm(origin, destination);
  const routeKey = `${origin.code}-${destination.code}`;
  const callsign = payload.identification?.callsign?.trim() || "UNKNOWN";
  const flightNumber = payload.identification?.number?.default?.trim() || callsign;
  const flightId = payload.identification?.id?.trim() || "";
  const airlineName = payload.airline?.name?.trim() || "Unknown operator";
  const aircraftModel = payload.aircraft?.model?.text?.trim();
  const sampleFlight: RouteSampleFlight = {
    flightId,
    flightNumber,
    callsign,
    statusText: payload.status?.text?.trim() || "Unknown",
    airlineName,
    aircraftModel,
    live: payload.status?.live ?? false,
    lastSeenAt: nowIso
  };

  const airlines: RouteAirlineCount[] = [
    {
      key: buildAirlineKey(payload),
      name: airlineName,
      iata: payload.airline?.code?.iata?.trim().toUpperCase(),
      icao: payload.airline?.code?.icao?.trim().toUpperCase(),
      count: 1
    }
  ];

  const aircraftModels: RouteAircraftCount[] = aircraftModel
    ? [
        {
          key: buildAircraftKey(aircraftModel),
          model: aircraftModel,
          count: 1
        }
      ]
    : [];

  const detail: CachedRouteDetail = {
    routeKey,
    routeLabel: buildRouteLabel(origin, destination),
    detailVersion: version,
    origin,
    destination,
    distanceKm,
    haulBucket: classifyHaul(distanceKm),
    observationCount: 1,
    firstSeenAt: nowIso,
    lastSeenAt: nowIso,
    airlines,
    aircraftModels,
    sampleFlights: [sampleFlight],
    lastFlight: {
      flightId,
      flightNumber,
      callsign,
      statusText: sampleFlight.statusText,
      airlineName,
      aircraftModel,
      scheduledDeparture: payload.time?.scheduled?.departure,
      scheduledArrival: payload.time?.scheduled?.arrival,
      trailPointCount: payload.trail?.filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng)).length ?? 0,
      live: sampleFlight.live
    }
  };

  return isUnknownRoute(detail) ? null : detail;
}

export function mergeRouteDetail(existing: CachedRouteDetail | null, incoming: CachedRouteDetail): CachedRouteDetail {
  if (!existing) {
    return incoming;
  }

  const incomingFlightKey = buildFlightIdentityKey(incoming.sampleFlights[0]);
  const duplicateFlight = existing.sampleFlights.some((sample) => buildFlightIdentityKey(sample) === incomingFlightKey);

  const airlineMap = new Map(existing.airlines.map((entry) => [entry.key, { ...entry }]));
  const aircraftMap = new Map(existing.aircraftModels.map((entry) => [entry.key, { ...entry }]));

  if (!duplicateFlight) {
    for (const airline of incoming.airlines) {
      const existingAirline = airlineMap.get(airline.key);
      if (existingAirline) {
        existingAirline.count += airline.count;
      } else {
        airlineMap.set(airline.key, { ...airline });
      }
    }

    for (const aircraft of incoming.aircraftModels) {
      const existingAircraft = aircraftMap.get(aircraft.key);
      if (existingAircraft) {
        existingAircraft.count += aircraft.count;
      } else {
        aircraftMap.set(aircraft.key, { ...aircraft });
      }
    }
  }

  const sampleMap = new Map(existing.sampleFlights.map((sample) => [buildFlightIdentityKey(sample), sample]));
  sampleMap.set(incomingFlightKey, incoming.sampleFlights[0]);

  return {
    ...existing,
    detailVersion: incoming.detailVersion,
    origin: incoming.origin,
    destination: incoming.destination,
    distanceKm: incoming.distanceKm,
    haulBucket: incoming.haulBucket,
    observationCount: duplicateFlight ? existing.observationCount : existing.observationCount + 1,
    firstSeenAt: existing.firstSeenAt < incoming.firstSeenAt ? existing.firstSeenAt : incoming.firstSeenAt,
    lastSeenAt: incoming.lastSeenAt,
    airlines: sortCountDescending([...airlineMap.values()]),
    aircraftModels: sortCountDescending([...aircraftMap.values()]),
    sampleFlights: trimSamples([...sampleMap.values()]),
    lastFlight: incoming.lastFlight
  };
}

function toRouteCatalogEntry(route: CachedRouteDetail): RouteCatalogEntry {
  return {
    routeKey: route.routeKey,
    routeLabel: route.routeLabel,
    origin: route.origin,
    destination: route.destination,
    distanceKm: route.distanceKm,
    haulBucket: route.haulBucket,
    observationCount: route.observationCount,
    lastSeenAt: route.lastSeenAt,
    airlines: route.airlines.slice(0, 4).map((entry) => ({
      value: entry.key,
      label: entry.name,
      count: entry.count
    })),
    aircraftModels: route.aircraftModels.slice(0, 4).map((entry) => ({
      value: entry.key,
      label: entry.model,
      count: entry.count
    })),
    sampleFlights: route.sampleFlights.slice(0, 4).map((sample) => ({
      flightId: sample.flightId,
      flightNumber: sample.flightNumber,
      callsign: sample.callsign,
      statusText: sample.statusText,
      lastSeenAt: sample.lastSeenAt
    }))
  };
}

function sortRoutes(routes: CachedRouteDetail[]): CachedRouteDetail[] {
  return [...routes].sort((left, right) => {
    if (right.observationCount !== left.observationCount) {
      return right.observationCount - left.observationCount;
    }

    return right.lastSeenAt.localeCompare(left.lastSeenAt);
  });
}

export function buildRouteCatalogSnapshot(
  routes: CachedRouteDetail[],
  options?: {
    updatedAt?: string;
    truncated?: boolean;
  }
): RouteCatalogSnapshot {
  const sortedRoutes = sortRoutes(routes);
  const airlineFacets = new Map<string, RouteCatalogFacet>();
  const aircraftFacets = new Map<string, RouteCatalogFacet>();
  const haulFacets = new Map<string, RouteCatalogFacet>();
  const originFacets = new Map<string, RouteCatalogFacet>();
  const destinationFacets = new Map<string, RouteCatalogFacet>();
  const countryFacets = new Map<string, RouteCatalogFacet>();

  for (const route of sortedRoutes) {
    const airlineKeys = new Set<string>();
    for (const airline of route.airlines) {
      const facetKey = normalizeText(airline.key);
      if (facetKey && !airlineKeys.has(facetKey)) {
        incrementFacetCount(airlineFacets, airline.key, airline.name);
        airlineKeys.add(facetKey);
      }
    }

    const aircraftKeys = new Set<string>();
    for (const aircraft of route.aircraftModels) {
      const facetKey = normalizeText(aircraft.key);
      if (facetKey && !aircraftKeys.has(facetKey)) {
        incrementFacetCount(aircraftFacets, aircraft.key, aircraft.model);
        aircraftKeys.add(facetKey);
      }
    }

    incrementFacetCount(haulFacets, route.haulBucket, route.haulBucket);
    incrementFacetCount(originFacets, route.origin.code, `${route.origin.code} · ${route.origin.name}`);
    incrementFacetCount(destinationFacets, route.destination.code, `${route.destination.code} · ${route.destination.name}`);

    if (route.origin.country) {
      incrementFacetCount(countryFacets, route.origin.country, route.origin.country);
    }

    if (route.destination.country) {
      incrementFacetCount(countryFacets, route.destination.country, route.destination.country);
    }
  }

  return {
    updatedAt: options?.updatedAt ?? new Date().toISOString(),
    totalRoutes: sortedRoutes.length,
    truncated: options?.truncated ?? false,
    routes: sortedRoutes.map(toRouteCatalogEntry),
    filters: {
      airlines: mapToFacets(airlineFacets),
      aircraftModels: mapToFacets(aircraftFacets),
      haulBuckets: mapToFacets(haulFacets),
      originAirports: mapToFacets(originFacets),
      destinationAirports: mapToFacets(destinationFacets),
      countries: mapToFacets(countryFacets)
    }
  };
}

function routeMatchesText(values: Array<string | undefined>, query: string | undefined): boolean {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) {
    return true;
  }

  return values.some((value) => normalizeText(value).includes(normalizedQuery));
}

function routeMatchesFacet(route: RouteCatalogEntry, filters: RouteCatalogFilters): boolean {
  if (filters.haul && normalizeText(route.haulBucket) !== normalizeText(filters.haul)) {
    return false;
  }

  if (
    !routeMatchesText(
      route.airlines.flatMap((airline) => [airline.value, airline.label]),
      filters.airline
    )
  ) {
    return false;
  }

  if (
    !routeMatchesText(
      route.aircraftModels.flatMap((aircraft) => [aircraft.value, aircraft.label]),
      filters.aircraft
    )
  ) {
    return false;
  }

  if (
    !routeMatchesText(
      [route.origin.code, route.origin.iata, route.origin.icao, route.origin.name, route.origin.city],
      filters.origin
    )
  ) {
    return false;
  }

  if (
    !routeMatchesText(
      [route.destination.code, route.destination.iata, route.destination.icao, route.destination.name, route.destination.city],
      filters.destination
    )
  ) {
    return false;
  }

  if (!routeMatchesText([route.origin.country, route.destination.country], filters.country)) {
    return false;
  }

  return true;
}

export function filterRouteCatalogSnapshot(snapshot: RouteCatalogSnapshot, filters: RouteCatalogFilters): RouteCatalogSnapshot {
  const matchedRoutes = snapshot.routes.filter((route) => routeMatchesFacet(route, filters));
  const limit = typeof filters.limit === "number" && Number.isFinite(filters.limit) ? filters.limit : matchedRoutes.length;
  const limitedRoutes = matchedRoutes.slice(0, Math.max(1, limit));

  return {
    ...snapshot,
    totalRoutes: matchedRoutes.length,
    routes: limitedRoutes
  };
}
