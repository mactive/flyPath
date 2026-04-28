export type FlightStatusTone = "ground" | "climbing" | "descending" | "cruise" | "approach";
export type RouteHaulBucket = "short" | "medium" | "long" | "ultra";

export interface FlightSummary {
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
  tone: FlightStatusTone;
}

export interface FlightSearchResult {
  id: string;
  type: string;
  label: string;
  callsign?: string;
  flight?: string;
  route?: string;
  registration?: string;
}

export interface FlightRoutePoint {
  lat: number;
  lng: number;
  alt?: number;
  spd?: number;
  ts?: number;
  hd?: number;
}

export interface AirportSnapshot {
  name: string;
  iata: string;
  icao: string;
  city?: string;
  country?: string;
  gate?: string | null;
  terminal?: string | null;
  latitude: number;
  longitude: number;
}

export interface FlightDetail {
  flightId: string;
  live: boolean;
  callsign: string;
  flightNumber: string;
  airlineName: string;
  airlineIata?: string;
  airlineIcao?: string;
  aircraftModel?: string;
  registration?: string;
  statusText: string;
  statusColor?: string;
  scheduledDeparture?: number;
  scheduledArrival?: number;
  realDeparture?: number;
  realArrival?: number | null;
  estimatedArrival?: number | null;
  altitudeProfile?: {
    currentFt: number;
    heading: number;
    speedKts: number;
  };
  origin: AirportSnapshot;
  destination: AirportSnapshot;
  trail: FlightRoutePoint[];
  imageUrl?: string;
  imageCredit?: string;
}

export interface FlightFeedSnapshot {
  flights: FlightSummary[];
  updatedAt: number;
}

export interface AirportBoardFlight {
  flightId: string | null;
  flightNumber: string;
  callsign: string | null;
  airlineName: string;
  statusText: string;
  statusTone: "live" | "scheduled" | "delayed" | "canceled" | "other";
  scheduledDeparture: number | null;
  estimatedDeparture: number | null;
  terminal: string | null;
  gate: string | null;
  destination: {
    iata: string;
    icao: string;
    name: string;
    city?: string;
    country?: string;
  };
}

export interface AirportBoard {
  airport: {
    iata: string;
    icao: string;
    name: string;
    city?: string;
    country?: string;
    timezone?: string;
    latitude: number;
    longitude: number;
  };
  timestamp: number | null;
  departuresVisible: number;
  departuresTotal: number;
  delayIndex: number | null;
  delayedShare: number | null;
  canceledShare: number | null;
  flights: AirportBoardFlight[];
}

export interface AirportBoardsSnapshot {
  boards: AirportBoard[];
  updatedAt: number;
}

export interface LiveRouteFlight extends FlightSummary {
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
  haulBucket: RouteHaulBucket | null;
  statusText: string | null;
  lastEnrichedAt: string | null;
}

export interface LiveRouteSummary {
  routeKey: string;
  routeLabel: string;
  originCode: string;
  originName: string;
  destinationCode: string;
  destinationName: string;
  distanceKm: number;
  haulBucket: RouteHaulBucket;
  activeFlights: number;
  airlines: string[];
  aircraftModels: string[];
  lastSeenAt: number;
}

export interface LiveRouteQueryFilters {
  airline?: string;
  aircraft?: string;
  origin?: string;
  destination?: string;
  haul?: RouteHaulBucket | "";
  country?: string;
  minDistanceKm?: number;
  maxDistanceKm?: number;
  onlyAirborne?: boolean;
  limit?: number;
}

export interface LiveRouteQuerySnapshot {
  updatedAt: string;
  coverage: {
    activeFlights: number;
    enrichedFlights: number;
    pendingEnrichment: number;
  };
  flights: LiveRouteFlight[];
  routes: LiveRouteSummary[];
}
