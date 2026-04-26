const FLIGHT_VIZ_BASE = "https://flight-viz.com";
const FLIGHT_VIZ_PROXY_BASE = "https://flight-viz-proxy.flight-viz.workers.dev";

async function requestJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      "user-agent": "sidecar-flight-monitor/0.1"
    }
  });

  if (!response.ok) {
    throw new Error(`Upstream request failed: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}

export const provider = {
  fetchStatesAll() {
    return requestJson(`${FLIGHT_VIZ_BASE}/api/states/all`);
  },
  searchFlights(query: string, limit: number) {
    const params = new URLSearchParams({
      query,
      limit: String(limit)
    });

    return requestJson(`${FLIGHT_VIZ_PROXY_BASE}/fr24/search?${params.toString()}`);
  },
  fetchFlightDetail(flightId: string, version = "1.5") {
    const params = new URLSearchParams({
      flight: flightId,
      version
    });

    return requestJson(`${FLIGHT_VIZ_PROXY_BASE}/fr24/detail?${params.toString()}`);
  }
};
