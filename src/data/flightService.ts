import {
  type RawAllFlightsResponse,
  type RawDetailResponse,
  type RawSearchResponse,
  normalizeFlightDetail,
  normalizeFlightFeed,
  normalizeSearchResults
} from "../utils/flightTransforms";
import type { FlightDetail, FlightFeedSnapshot, FlightSearchResult, FlightSummary } from "../types/flight";

const API_BASE = import.meta.env.VITE_API_BASE ?? (import.meta.env.DEV ? "http://127.0.0.1:8787" : "");

function describeHtmlPayload(payload: string): string {
  const normalized = payload.trim().toLowerCase();

  if (normalized.startsWith("<!doctype") || normalized.startsWith("<html")) {
    return "API returned HTML instead of JSON. Start the Hono server with `npm run dev` or serve the built app with `npm run start:server`.";
  }

  return `Unexpected response payload: ${payload.slice(0, 120)}`;
}

async function requestJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API_BASE}${url}`, { signal });
  const contentType = response.headers.get("content-type") ?? "";
  const raw = await response.text();

  if (!response.ok) {
    const message = raw ? `${response.status} ${describeHtmlPayload(raw)}` : `Request failed: ${response.status}`;
    throw new Error(message);
  }

  if (!contentType.includes("application/json")) {
    throw new Error(describeHtmlPayload(raw));
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(describeHtmlPayload(raw));
  }
}

export async function fetchFlightFeed(signal?: AbortSignal): Promise<FlightFeedSnapshot> {
  const payload = await requestJson<RawAllFlightsResponse>("/api/states/all", signal);
  return normalizeFlightFeed(payload);
}

export async function searchFlight(query: string, signal?: AbortSignal): Promise<FlightSearchResult[]> {
  const payload = await requestJson<RawSearchResponse>(
    "/api/fr24/search?query=" + encodeURIComponent(query) + "&limit=8",
    signal
  );
  return normalizeSearchResults(payload);
}

export async function fetchFlightDetailById(flightId: string, signal?: AbortSignal): Promise<FlightDetail> {
  const payload = await requestJson<RawDetailResponse>(
    "/api/fr24/detail?flight=" + encodeURIComponent(flightId) + "&version=1.5",
    signal
  );

  return normalizeFlightDetail(payload);
}

export async function fetchFlightDetail(
  flight: FlightSummary,
  signal?: AbortSignal
): Promise<{ detail: FlightDetail; searchResults: FlightSearchResult[] }> {
  const primaryQuery = flight.callsign;
  const searchResults = await searchFlight(primaryQuery, signal);
  const selected = searchResults.find((result) => result.type === "live") ?? searchResults[0];

  if (!selected) {
    throw new Error("No detail match was returned for this flight.");
  }

  const detail = await fetchFlightDetailById(selected.id, signal);
  return { detail, searchResults };
}
