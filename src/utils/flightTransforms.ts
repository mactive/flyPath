import type {
  AirportSnapshot,
  FlightDetail,
  FlightFeedSnapshot,
  FlightRoutePoint,
  FlightSearchResult,
  FlightStatusTone,
  FlightSummary
} from "../types/flight";

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

export interface RawAllFlightsResponse {
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
    route?: string;
    reg?: string;
  };
}

export interface RawSearchResponse {
  results?: RawSearchResult[];
}

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
  info?: {
    gate?: string | null;
    terminal?: string | null;
  };
}

export interface RawDetailResponse {
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
    icon?: string;
  };
  aircraft?: {
    model?: {
      text?: string;
    };
    registration?: string;
    images?: {
      medium?: Array<{
        src?: string;
        copyright?: string;
      }>;
    };
  };
  airline?: {
    name?: string;
    code?: {
      iata?: string;
      icao?: string;
    };
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
    real?: {
      departure?: number;
      arrival?: number | null;
    };
    estimated?: {
      arrival?: number | null;
    };
  };
  trail?: FlightRoutePoint[];
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

function normalizeCallsign(value: string | null | undefined): string {
  return value?.trim() || "UNTRACKED";
}

function deriveTone(onGround: boolean, altitudeFt: number, verticalRateFpm: number): FlightStatusTone {
  if (onGround) {
    return "ground";
  }

  if (verticalRateFpm > 900) {
    return "climbing";
  }

  if (verticalRateFpm < -900) {
    return "descending";
  }

  if (altitudeFt < 8000) {
    return "approach";
  }

  return "cruise";
}

function deriveStatusLabel(tone: FlightStatusTone): string {
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

function normalizeAirportSnapshot(airport?: RawAirport): AirportSnapshot {
  return {
    name: airport?.name || "Unknown airport",
    iata: airport?.code?.iata || "---",
    icao: airport?.code?.icao || "---",
    city: airport?.position?.region?.city,
    country: airport?.position?.country?.name,
    gate: airport?.info?.gate ?? null,
    terminal: airport?.info?.terminal ?? null,
    latitude: airport?.position?.latitude ?? 0,
    longitude: airport?.position?.longitude ?? 0
  };
}

export function normalizeFlightFeed(payload: RawAllFlightsResponse): FlightFeedSnapshot {
  const flights = payload.states
    .filter((state) => state[5] !== null && state[6] !== null)
    .map<FlightSummary>((state) => {
      const altitudeFt = metersToFeet(state[13] ?? state[7]);
      const verticalRateFpm = metersPerSecondToFeetPerMinute(state[11]);
      const tone = deriveTone(state[8], altitudeFt, verticalRateFpm);

      return {
        id: state[0],
        callsign: normalizeCallsign(state[1]),
        country: state[2] || "Unknown",
        longitude: state[5] ?? 0,
        latitude: state[6] ?? 0,
        altitudeFt,
        onGround: state[8],
        groundSpeedKts: metersPerSecondToKnots(state[9]),
        heading: Math.round(state[10] ?? 0),
        verticalRateFpm,
        squawk: state[14],
        lastContact: state[4] ?? payload.time,
        statusLabel: deriveStatusLabel(tone),
        tone
      };
    });

  return {
    flights,
    updatedAt: payload.time
  };
}

export function normalizeSearchResults(payload: RawSearchResponse): FlightSearchResult[] {
  return (payload.results ?? []).map((result) => ({
    id: result.id,
    type: result.type,
    label: result.label,
    callsign: result.detail?.callsign,
    flight: result.detail?.flight,
    route: result.detail?.route,
    registration: result.detail?.reg
  }));
}

export function normalizeFlightDetail(payload: RawDetailResponse): FlightDetail {
  const image = payload.aircraft?.images?.medium?.[0];
  const trail = (payload.trail ?? []).filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
  const lastTrailPoint = trail[0];

  return {
    flightId: payload.identification?.id || "",
    live: payload.status?.live ?? false,
    callsign: payload.identification?.callsign || "UNKNOWN",
    flightNumber: payload.identification?.number?.default || payload.identification?.callsign || "UNKNOWN",
    airlineName: payload.airline?.name || "Unknown operator",
    airlineIata: payload.airline?.code?.iata,
    airlineIcao: payload.airline?.code?.icao,
    aircraftModel: payload.aircraft?.model?.text,
    registration: payload.aircraft?.registration,
    statusText: payload.status?.text || "Live",
    statusColor: payload.status?.icon,
    scheduledDeparture: payload.time?.scheduled?.departure,
    scheduledArrival: payload.time?.scheduled?.arrival,
    realDeparture: payload.time?.real?.departure,
    realArrival: payload.time?.real?.arrival ?? null,
    estimatedArrival: payload.time?.estimated?.arrival ?? null,
    altitudeProfile: lastTrailPoint
      ? {
          currentFt: lastTrailPoint.alt ?? 0,
          heading: lastTrailPoint.hd ?? 0,
          speedKts: lastTrailPoint.spd ?? 0
        }
      : undefined,
    origin: normalizeAirportSnapshot(payload.airport?.origin),
    destination: normalizeAirportSnapshot(payload.airport?.destination),
    trail,
    imageUrl: image?.src,
    imageCredit: image?.copyright
  };
}
