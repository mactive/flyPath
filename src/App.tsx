import { startTransition, useDeferredValue, useEffect, useMemo, useState } from "react";
import { FlightMap } from "./components/FlightMap";
import { GlobeBackdrop } from "./components/GlobeBackdrop";
import { fetchFlightDetail, fetchFlightFeed } from "./data/flightService";
import type { FlightDetail, FlightSearchResult, FlightSummary } from "./types/flight";

const REFRESH_MS = 60_000;
const GLOBAL_RENDER_DIVISOR = 4;

function formatTimestamp(timestamp?: number | null): string {
  if (!timestamp) {
    return "--";
  }

  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(timestamp * 1000);
}

function formatRelativeMinutes(timestamp?: number | null): string {
  if (!timestamp) {
    return "--";
  }

  const diffMinutes = Math.round((timestamp * 1000 - Date.now()) / 60000);

  if (diffMinutes === 0) {
    return "due now";
  }

  if (diffMinutes > 0) {
    return `+${diffMinutes} min`;
  }

  return `${diffMinutes} min`;
}

function formatFlightCount(value: number): string {
  return value.toLocaleString("en-US");
}

function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1
  }).format(value);
}

function hashFlightId(value: string): number {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash;
}

function summarizeDensity(flights: FlightSummary[]) {
  return flights.reduce(
    (accumulator, flight) => {
      accumulator.airborne += flight.onGround ? 0 : 1;
      accumulator.grounded += flight.onGround ? 1 : 0;
      accumulator.maxAltitude = Math.max(accumulator.maxAltitude, flight.altitudeFt);
      accumulator.fastest = Math.max(accumulator.fastest, flight.groundSpeedKts);
      accumulator.countries.set(flight.country, (accumulator.countries.get(flight.country) ?? 0) + 1);
      return accumulator;
    },
    {
      airborne: 0,
      grounded: 0,
      maxAltitude: 0,
      fastest: 0,
      countries: new Map<string, number>()
    }
  );
}

export default function App() {
  const [flights, setFlights] = useState<FlightSummary[]>([]);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(true);
  const [query, setQuery] = useState("");
  const [activeCountry, setActiveCountry] = useState<string | null>(null);
  const [selectedFlight, setSelectedFlight] = useState<FlightSummary | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<FlightDetail | null>(null);
  const [detailMatches, setDetailMatches] = useState<FlightSearchResult[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const deferredQuery = useDeferredValue(query);

  useEffect(() => {
    let active = true;

    const loadFeed = async () => {
      setRefreshing(true);

      try {
        const snapshot = await fetchFlightFeed();

        if (!active) {
          return;
        }

        startTransition(() => {
          setFlights(snapshot.flights);
          setLastUpdated(snapshot.updatedAt);
          setFeedError(null);
        });
      } catch (error) {
        if (!active) {
          return;
        }

        setFeedError(error instanceof Error ? error.message : "Feed unavailable");
      } finally {
        if (active) {
          setRefreshing(false);
        }
      }
    };

    void loadFeed();
    const interval = window.setInterval(loadFeed, REFRESH_MS);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!selectedFlight) {
      return;
    }

    const refreshed = flights.find((flight) => flight.id === selectedFlight.id);

    if (refreshed) {
      setSelectedFlight(refreshed);
    }
  }, [flights, selectedFlight]);

  useEffect(() => {
    if (!selectedFlight) {
      return undefined;
    }

    const controller = new AbortController();

    const loadDetail = async () => {
      setDetailLoading(true);
      setDetailError(null);

      try {
        const { detail, searchResults } = await fetchFlightDetail(selectedFlight, controller.signal);

        setSelectedDetail(detail);
        setDetailMatches(searchResults);
      } catch (error) {
        if (!controller.signal.aborted) {
          setSelectedDetail(null);
          setDetailMatches([]);
          setDetailError(error instanceof Error ? error.message : "Unable to load flight detail.");
        }
      } finally {
        if (!controller.signal.aborted) {
          setDetailLoading(false);
        }
      }
    };

    void loadDetail();

    return () => {
      controller.abort();
    };
  }, [selectedFlight]);

  const filteredFlights = useMemo(() => {
    const normalizedQuery = deferredQuery.trim().toLowerCase();

    return flights.filter((flight) => {
      const matchesCountry = activeCountry ? flight.country === activeCountry : true;
      const matchesQuery =
        !normalizedQuery ||
        flight.callsign.toLowerCase().includes(normalizedQuery) ||
        flight.country.toLowerCase().includes(normalizedQuery) ||
        flight.id.toLowerCase().includes(normalizedQuery) ||
        (flight.squawk ?? "").toLowerCase().includes(normalizedQuery);

      return matchesCountry && matchesQuery;
    });
  }, [activeCountry, deferredQuery, flights]);

  const renderedFlights = useMemo(() => {
    if (activeCountry) {
      return filteredFlights;
    }

    return filteredFlights.filter((flight) => hashFlightId(flight.id) % GLOBAL_RENDER_DIVISOR === 0);
  }, [activeCountry, filteredFlights]);

  const density = useMemo(() => summarizeDensity(flights), [flights]);
  const topCountries = useMemo(
    () =>
      Array.from(density.countries.entries())
        .sort((left, right) => right[1] - left[1]),
    [density.countries]
  );
  const activeList = useMemo(
    () =>
      [...filteredFlights]
        .sort((left, right) => right.groundSpeedKts - left.groundSpeedKts)
        .slice(0, 8),
    [filteredFlights]
  );

  useEffect(() => {
    if (!selectedFlight) {
      return;
    }

    const stillVisible = filteredFlights.some((flight) => flight.id === selectedFlight.id);

    if (!stillVisible) {
      setSelectedFlight(null);
      setSelectedDetail(null);
      setDetailMatches([]);
      setDetailError(null);
    }
  }, [filteredFlights, selectedFlight]);

  return (
    <div className="app-shell">
      <GlobeBackdrop />

      <div className="screen-noise" aria-hidden="true" />
      <div className="scanline" aria-hidden="true" />

      <main className="layout">
        <header className="topbar panel">
          <div className="brand-block">
            <p className="eyebrow">SideCar Monitor</p>
            <h1>Global Flight Intelligence</h1>
          </div>

          <div className="topbar-metrics">
            <div className="metric-chip">
              <span>Tracked</span>
              <strong>{formatFlightCount(flights.length)}</strong>
            </div>
            <div className="metric-chip">
              <span>Airborne</span>
              <strong>{formatFlightCount(density.airborne)}</strong>
            </div>
            <div className="metric-chip">
              <span>Last sync</span>
              <strong>{lastUpdated ? formatTimestamp(lastUpdated) : "--"}</strong>
            </div>
          </div>
        </header>

        <section className="content-grid">
          <aside className="panel left-rail">
            <div className="section-head">
              <div>
                <p className="eyebrow">Flight index</p>
                <h2>Search & pressure</h2>
              </div>
              <span className="badge">
                {formatFlightCount(renderedFlights.length)} rendered / {formatFlightCount(filteredFlights.length)} matched
              </span>
            </div>

            <label className="search-box">
              <span className="search-label">Query</span>
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="callsign, country, squawk, ICAO24"
              />
            </label>

            <div className="kpi-stack">
              <article className="kpi-card">
                <span>Peak altitude</span>
                <strong>{formatCompactNumber(density.maxAltitude)} ft</strong>
              </article>
              <article className="kpi-card">
                <span>Fastest track</span>
                <strong>{formatCompactNumber(density.fastest)} kts</strong>
              </article>
              <article className="kpi-card">
                <span>Grounded share</span>
                <strong>{flights.length ? Math.round((density.grounded / flights.length) * 100) : 0}%</strong>
              </article>
            </div>

            <section className="rail-group">
              <div className="section-head compact">
                <h3>Countries</h3>
              </div>
              <div className="country-filter-grid">
                <button
                  type="button"
                  className={`country-chip ${activeCountry === null ? "is-active" : ""}`}
                  onClick={() => setActiveCountry(null)}
                >
                  <span>World</span>
                  <strong>{formatFlightCount(flights.length)}</strong>
                </button>
                {topCountries.map(([country, count]) => (
                  <button
                    key={country}
                    type="button"
                    className={`country-chip ${activeCountry === country ? "is-active" : ""}`}
                    onClick={() => setActiveCountry(country)}
                  >
                    <span>{country}</span>
                    <strong>{count}</strong>
                  </button>
                ))}
              </div>
            </section>

            <section className="rail-group">
              <div className="section-head compact">
                <h3>Fast movers</h3>
              </div>
              <div className="flight-list">
                {activeList.map((flight) => (
                  <button
                    key={flight.id}
                    type="button"
                    className={`flight-list-item ${selectedFlight?.id === flight.id ? "is-selected" : ""}`}
                    onClick={() => setSelectedFlight(flight)}
                  >
                    <div>
                      <strong>{flight.callsign}</strong>
                      <span>
                        {flight.country} · {flight.statusLabel}
                      </span>
                    </div>
                    <em>{flight.groundSpeedKts} kts</em>
                  </button>
                ))}
              </div>
            </section>
          </aside>

          <section className="center-column">
            <FlightMap
              flights={renderedFlights}
              selectedFlight={selectedFlight}
              selectedDetail={selectedDetail}
              onSelectFlight={setSelectedFlight}
              refreshing={refreshing}
            />

            <section className="panel lower-strip">
              <div className="section-head">
                <div>
                  <p className="eyebrow">Live situation</p>
                  <h2>Feed characteristics</h2>
                </div>
              </div>
              <div className="stats-grid">
                <article className="stat-panel">
                  <span>Coverage</span>
                  <strong>Global</strong>
                  <p>Natural Earth country geometry with OpenSky feed and FR24-derived detail enrichment.</p>
                </article>
                <article className="stat-panel">
                  <span>Cadence</span>
                  <strong>60s</strong>
                  <p>Whole-map refresh cycle, with country drill-in rendering and on-demand detail cache.</p>
                </article>
                <article className="stat-panel">
                  <span>Interaction</span>
                  <strong>Route focus</strong>
                  <p>Wheel zoom, drag or WASD pan, then click a flight to reveal its trail and route pair.</p>
                </article>
              </div>
            </section>
          </section>

          <aside className="panel right-rail">
            <div className="section-head">
              <div>
                <p className="eyebrow">Selected track</p>
                <h2>{selectedFlight?.callsign ?? "Choose a flight"}</h2>
              </div>
              {selectedFlight && <span className="badge">{selectedFlight.statusLabel}</span>}
            </div>

            {!selectedFlight && (
              <div className="empty-state">
                Click any aircraft on the map or the left rail list to load its route, airports, and live status.
              </div>
            )}

            {selectedFlight && (
              <>
                <div className="detail-summary">
                  <article className="detail-metric">
                    <span>Altitude</span>
                    <strong>{formatFlightCount(selectedFlight.altitudeFt)} ft</strong>
                  </article>
                  <article className="detail-metric">
                    <span>Speed</span>
                    <strong>{selectedFlight.groundSpeedKts} kts</strong>
                  </article>
                  <article className="detail-metric">
                    <span>Heading</span>
                    <strong>{selectedFlight.heading}°</strong>
                  </article>
                  <article className="detail-metric">
                    <span>Vertical</span>
                    <strong>{selectedFlight.verticalRateFpm} fpm</strong>
                  </article>
                </div>

                {detailLoading && <div className="status-banner">Resolving FR24 detail chain…</div>}
                {detailError && <div className="status-banner error">{detailError}</div>}
                {feedError && <div className="status-banner error">Feed issue: {feedError}</div>}

                {selectedDetail && (
                  <div className="detail-card">
                    {selectedDetail.imageUrl && (
                      <div className="detail-image-wrap">
                        <img src={selectedDetail.imageUrl} alt={selectedDetail.aircraftModel || selectedDetail.callsign} />
                      </div>
                    )}

                    <div className="detail-card-body">
                      <div className="identity-row">
                        <div>
                          <h3>{selectedDetail.flightNumber}</h3>
                          <p>
                            {selectedDetail.airlineName}
                            {selectedDetail.aircraftModel ? ` · ${selectedDetail.aircraftModel}` : ""}
                          </p>
                        </div>
                        <span className={`live-pill ${selectedDetail.live ? "live" : ""}`}>
                          {selectedDetail.statusText}
                        </span>
                      </div>

                      <div className="route-box">
                        <div>
                          <strong>{selectedDetail.origin.iata}</strong>
                          <span>{selectedDetail.origin.city || selectedDetail.origin.name}</span>
                        </div>
                        <div className="route-arrow">→</div>
                        <div>
                          <strong>{selectedDetail.destination.iata}</strong>
                          <span>{selectedDetail.destination.city || selectedDetail.destination.name}</span>
                        </div>
                      </div>

                      <div className="timeline-list">
                        <div className="timeline-row">
                          <span>Scheduled departure</span>
                          <strong>{formatTimestamp(selectedDetail.scheduledDeparture)}</strong>
                        </div>
                        <div className="timeline-row">
                          <span>Estimated arrival</span>
                          <strong>{formatTimestamp(selectedDetail.estimatedArrival)}</strong>
                        </div>
                        <div className="timeline-row">
                          <span>ETA delta</span>
                          <strong>{formatRelativeMinutes(selectedDetail.estimatedArrival)}</strong>
                        </div>
                        <div className="timeline-row">
                          <span>Registration</span>
                          <strong>{selectedDetail.registration ?? "--"}</strong>
                        </div>
                      </div>

                      <div className="match-list">
                        {detailMatches.slice(0, 3).map((match) => (
                          <div key={match.id} className="match-row">
                            <span>{match.type}</span>
                            <strong>{match.label}</strong>
                          </div>
                        ))}
                      </div>

                      {selectedDetail.imageCredit && (
                        <p className="credit-note">Photo credit: {selectedDetail.imageCredit}</p>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </aside>
        </section>
      </main>
    </div>
  );
}
