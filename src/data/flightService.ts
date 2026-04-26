import {
  type RawAllFlightsResponse,
  type RawDetailResponse,
  type RawSearchResponse,
  normalizeFlightDetail,
  normalizeFlightFeed,
  normalizeSearchResults
} from "../utils/flightTransforms";
import type { FlightDetail, FlightFeedSnapshot, FlightSearchResult, FlightSummary } from "../types/flight";

async function requestJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export async function fetchFlightFeed(signal?: AbortSignal): Promise<FlightFeedSnapshot> {
  const payload = await requestJson<RawAllFlightsResponse>("/api/states/all", signal);
  return normalizeFlightFeed(payload);
}

export async function searchFlight(query: string, signal?: AbortSignal): Promise<FlightSearchResult[]> {
  const payload = await requestJson<RawSearchResponse>(
    "/proxy/fr24/search?query=" + encodeURIComponent(query) + "&limit=8",
    signal
  );
  return normalizeSearchResults(payload);
}

export async function fetchFlightDetailById(flightId: string, signal?: AbortSignal): Promise<FlightDetail> {
  const payload = await requestJson<RawDetailResponse>(
    "/proxy/fr24/detail?flight=" + encodeURIComponent(flightId) + "&version=1.5",
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
