const FLIGHT_VIZ_BASE = "https://flight-viz.com";
const FLIGHT_VIZ_PROXY_BASE = "https://flight-viz-proxy.flight-viz.workers.dev";
const DEFAULT_TOP_AIRPORT_CODES = [
  "HND",
  "ATL",
  "DXB",
  "LHR",
  "DFW",
  "DEN",
  "IST",
  "ORD",
  "LAX",
  "DEL",
  "CDG",
  "AMS",
  "FRA",
  "SIN",
  "ICN",
  "CAN",
  "PVG",
  "JFK",
  "BKK",
  "MAD"
] as const;

interface RawAirportBoardResponse {
  result?: {
    response?: {
      airport?: {
        pluginData?: {
          details?: {
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
            timezone?: {
              name?: string;
            };
            stats?: {
              departures?: {
                delayIndex?: number;
                recent?: {
                  percentage?: {
                    delayed?: number;
                    canceled?: number;
                  };
                };
              };
            };
          };
          schedule?: {
            departures?: {
              item?: {
                current?: number;
                total?: number;
              };
              timestamp?: number;
              data?: Array<{
                flight?: {
                  identification?: {
                    id?: string | null;
                    number?: {
                      default?: string;
                    };
                    callsign?: string | null;
                  };
                  airline?: {
                    name?: string;
                  };
                  status?: {
                    text?: string;
                    icon?: string | null;
                  };
                  airport?: {
                    origin?: {
                      info?: {
                        terminal?: string | null;
                        gate?: string | null;
                      };
                    };
                    destination?: {
                      name?: string;
                      code?: {
                        iata?: string;
                        icao?: string;
                      };
                      position?: {
                        country?: {
                          name?: string;
                        };
                        region?: {
                          city?: string;
                        };
                      };
                    };
                  };
                  time?: {
                    scheduled?: {
                      departure?: number | null;
                    };
                    estimated?: {
                      departure?: number | null;
                    };
                  };
                };
              }>;
            };
          };
        };
      };
    };
  };
}

function deriveBoardStatusTone(icon?: string | null, text?: string) {
  const normalizedText = (text ?? "").toLowerCase();

  if (icon === "yellow" || normalizedText.includes("delay")) {
    return "delayed";
  }

  if (icon === "red" || normalizedText.includes("cancel")) {
    return "canceled";
  }

  if (icon === "gray" || normalizedText.includes("scheduled")) {
    return "scheduled";
  }

  if (icon === "green") {
    return "live";
  }

  return "other";
}

function normalizeAirportBoard(code: string, payload: RawAirportBoardResponse) {
  const details = payload.result?.response?.airport?.pluginData?.details;
  const departures = payload.result?.response?.airport?.pluginData?.schedule?.departures;

  return {
    airport: {
      iata: details?.code?.iata ?? code,
      icao: details?.code?.icao ?? "---",
      name: details?.name ?? code,
      city: details?.position?.region?.city,
      country: details?.position?.country?.name,
      timezone: details?.timezone?.name,
      latitude: details?.position?.latitude ?? 0,
      longitude: details?.position?.longitude ?? 0
    },
    timestamp: departures?.timestamp ?? null,
    departuresVisible: departures?.item?.current ?? 0,
    departuresTotal: departures?.item?.total ?? 0,
    delayIndex: details?.stats?.departures?.delayIndex ?? null,
    delayedShare: details?.stats?.departures?.recent?.percentage?.delayed ?? null,
    canceledShare: details?.stats?.departures?.recent?.percentage?.canceled ?? null,
    flights: (departures?.data ?? []).slice(0, 6).map((entry) => {
      const flight = entry.flight;
      return {
        flightId: flight?.identification?.id ?? null,
        flightNumber: flight?.identification?.number?.default ?? flight?.identification?.callsign ?? "UNKNOWN",
        callsign: flight?.identification?.callsign ?? null,
        airlineName: flight?.airline?.name ?? "Unknown carrier",
        statusText: flight?.status?.text ?? "Scheduled",
        statusTone: deriveBoardStatusTone(flight?.status?.icon, flight?.status?.text),
        scheduledDeparture: flight?.time?.scheduled?.departure ?? null,
        estimatedDeparture: flight?.time?.estimated?.departure ?? null,
        terminal: flight?.airport?.origin?.info?.terminal ?? null,
        gate: flight?.airport?.origin?.info?.gate ?? null,
        destination: {
          iata: flight?.airport?.destination?.code?.iata ?? "---",
          icao: flight?.airport?.destination?.code?.icao ?? "---",
          name: flight?.airport?.destination?.name ?? "Unknown destination",
          city: flight?.airport?.destination?.position?.region?.city,
          country: flight?.airport?.destination?.position?.country?.name
        }
      };
    })
  };
}

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
  },
  fetchTopAirportBoards() {
    return Promise.all(
      DEFAULT_TOP_AIRPORT_CODES.map(async (code) => {
        const params = new URLSearchParams({ code });
        const payload = await requestJson<RawAirportBoardResponse>(`${FLIGHT_VIZ_PROXY_BASE}/fr24/airport?${params.toString()}`);
        return normalizeAirportBoard(code, payload);
      })
    ).then((boards) => ({
      boards,
      updatedAt: Math.floor(Date.now() / 1000)
    }));
  }
};
