export type FlightStatusTone = "ground" | "climbing" | "descending" | "cruise" | "approach";

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
