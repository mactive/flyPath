import { KV_KEYS, envFlag, envNumber } from "./constants.js";
import type { WorkerBindings } from "./bindings.js";
import { upstream } from "./upstream.js";

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

function getTopAirportCodes(env: WorkerBindings) {
  const configured = env.TOP_AIRPORT_CODES?.split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);

  return configured && configured.length > 0 ? configured : [...DEFAULT_TOP_AIRPORT_CODES];
}

function deriveBoardStatusTone(icon?: string | null, text?: string) {
  const normalizedText = (text ?? "").toLowerCase();

  if (icon === "yellow" || normalizedText.includes("delay")) {
    return "delayed" as const;
  }

  if (icon === "red" || normalizedText.includes("cancel")) {
    return "canceled" as const;
  }

  if (icon === "gray" || normalizedText.includes("scheduled")) {
    return "scheduled" as const;
  }

  if (icon === "green") {
    return "live" as const;
  }

  return "other" as const;
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

function archiveKey(now = new Date()) {
  const iso = now.toISOString();
  const [date, time] = iso.split("T");
  const [year, month, day] = date.split("-");
  const minute = time.slice(0, 5).replace(":", "/");
  return `snapshots/${year}/${month}/${day}/${minute}.json`;
}

export async function refreshLatestSnapshot(env: WorkerBindings) {
  const payload = await upstream.fetchStatesAll(env);
  const snapshotTtl = envNumber(env.SNAPSHOT_TTL_SECONDS, 90);
  const body = JSON.stringify(payload);
  const archivedAt = new Date().toISOString();
  const objectKey = archiveKey();

  await env.FLIGHT_CACHE.put(KV_KEYS.latestSnapshot, body, {
    expirationTtl: snapshotTtl
  });

  await env.FLIGHT_CACHE.put(
    KV_KEYS.latestSnapshotMeta,
    JSON.stringify({
      archivedAt,
      objectKey
    }),
    {
      expirationTtl: snapshotTtl
    }
  );

  if (envFlag(env.ENABLE_SNAPSHOT_ARCHIVE, true)) {
    await env.SNAPSHOT_ARCHIVE.put(objectKey, body, {
      httpMetadata: {
        contentType: "application/json"
      }
    });
  }

  return payload;
}

export async function refreshTopAirportBoards(env: WorkerBindings) {
  const airportBoardTtl = envNumber(env.AIRPORT_BOARD_TTL_SECONDS, 240);
  const codes = getTopAirportCodes(env);
  const settled = await Promise.all(
    codes.map(async (code) => {
      try {
        const payload = await upstream.fetchAirportSchedule(env, code);
        return normalizeAirportBoard(code, payload as RawAirportBoardResponse);
      } catch (error) {
        console.error(`airport board refresh failed for ${code}`, error);
        return null;
      }
    })
  );
  const boards = settled.filter((board): board is NonNullable<typeof board> => board !== null);
  const payload = {
    boards,
    updatedAt: Math.floor(Date.now() / 1000)
  };

  await env.FLIGHT_CACHE.put(KV_KEYS.topAirportBoards, JSON.stringify(payload), {
    expirationTtl: airportBoardTtl
  });

  return payload;
}

export async function getLatestSnapshot(env: WorkerBindings) {
  const cached = await env.FLIGHT_CACHE.get(KV_KEYS.latestSnapshot, "json");

  if (cached) {
    return cached;
  }

  return refreshLatestSnapshot(env);
}

export async function getTopAirportBoards(env: WorkerBindings) {
  const cached = await env.FLIGHT_CACHE.get(KV_KEYS.topAirportBoards, "json");

  if (cached) {
    return cached;
  }

  return refreshTopAirportBoards(env);
}

export async function getFlightSearch(env: WorkerBindings, query: string, limit: number) {
  const key = KV_KEYS.search(query, limit);
  const cached = await env.FLIGHT_CACHE.get(key, "json");

  if (cached) {
    return cached;
  }

  const payload = await upstream.searchFlights(env, query, limit);
  await env.FLIGHT_CACHE.put(key, JSON.stringify(payload), {
    expirationTtl: envNumber(env.SEARCH_TTL_SECONDS, 300)
  });
  return payload;
}

export async function getFlightDetail(env: WorkerBindings, flightId: string, version: string) {
  const key = KV_KEYS.detail(flightId, version);
  const cached = await env.FLIGHT_CACHE.get(key, "json");

  if (cached) {
    return cached;
  }

  const payload = await upstream.fetchFlightDetail(env, flightId, version);
  await env.FLIGHT_CACHE.put(key, JSON.stringify(payload), {
    expirationTtl: envNumber(env.DETAIL_TTL_SECONDS, 1800)
  });
  return payload;
}
