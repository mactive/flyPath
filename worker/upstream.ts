import type { WorkerBindings } from "./bindings.js";

async function requestJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      "user-agent": "sidecar-flight-monitor-worker/0.1"
    }
  });

  if (!response.ok) {
    throw new Error(`Upstream request failed: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}

export const upstream = {
  fetchStatesAll(env: WorkerBindings) {
    return requestJson(`${env.UPSTREAM_BASE_URL}/api/states/all`);
  },
  searchFlights(env: WorkerBindings, query: string, limit: number) {
    const params = new URLSearchParams({
      query,
      limit: String(limit)
    });

    return requestJson(`${env.UPSTREAM_PROXY_BASE_URL}/fr24/search?${params.toString()}`);
  },
  fetchFlightDetail(env: WorkerBindings, flightId: string, version = "1.5") {
    const params = new URLSearchParams({
      flight: flightId,
      version
    });

    return requestJson(`${env.UPSTREAM_PROXY_BASE_URL}/fr24/detail?${params.toString()}`);
  },
  fetchAirportSchedule(env: WorkerBindings, code: string) {
    const params = new URLSearchParams({
      code
    });

    return requestJson(`${env.UPSTREAM_PROXY_BASE_URL}/fr24/airport?${params.toString()}`);
  }
};
