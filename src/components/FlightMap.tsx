import maplibregl, { type GeoJSONSource, type LngLatBoundsLike, type Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Protocol } from "pmtiles";
import { useEffect, useRef } from "react";
import { buildPredictionCoordinates, buildTrailCoordinates, type LngLatTuple } from "../utils/geo";
import type { FlightDetail, FlightSummary } from "../types/flight";

const DEFAULT_STYLE_URL = import.meta.env.VITE_MAP_STYLE_URL ?? "https://demotiles.maplibre.org/style.json";
const FLIGHTS_SOURCE_ID = "flights";
const SELECTED_SOURCE_ID = "selected-flight";
const HOVER_SOURCE_ID = "hover-flight";
const TRAIL_SOURCE_ID = "flight-trail";
const PROJECTION_SOURCE_ID = "flight-projection";
const AIRPORT_SOURCE_ID = "flight-airports";
const CURSOR_SOURCE_ID = "flight-route-cursor";

const pmtilesProtocol = new Protocol();
let pmtilesRegistered = false;

interface FlightMapProps {
  flights: FlightSummary[];
  focusFlights: FlightSummary[];
  selectedFlight: FlightSummary | null;
  selectedDetail: FlightDetail | null;
  onSelectFlight: (flight: FlightSummary) => void;
  refreshing: boolean;
  activeCountry: string | null;
}

function ensurePmtilesProtocol() {
  if (!pmtilesRegistered) {
    maplibregl.addProtocol("pmtiles", pmtilesProtocol.tile);
    pmtilesRegistered = true;
  }
}

function emptyFeatureCollection<T extends GeoJSON.Geometry>(): GeoJSON.FeatureCollection<T> {
  return {
    type: "FeatureCollection",
    features: []
  };
}

function getSource<T extends GeoJSON.Geometry>(
  map: MapLibreMap | null,
  id: string
): GeoJSONSource | null {
  if (!map || !map.getSource(id)) {
    return null;
  }

  return map.getSource(id) as GeoJSONSource;
}

function buildFlightFeatureCollection(flights: FlightSummary[]): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: "FeatureCollection",
    features: flights.map((flight) => ({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [flight.longitude, flight.latitude]
      },
      properties: {
        id: flight.id,
        callsign: flight.callsign,
        country: flight.country,
        tone: flight.tone,
        altitudeFt: flight.altitudeFt,
        speedKts: flight.groundSpeedKts
      }
    }))
  };
}

function buildSelectedFeatureCollection(flight: FlightSummary | null): GeoJSON.FeatureCollection<GeoJSON.Point> {
  if (!flight) {
    return emptyFeatureCollection<GeoJSON.Point>();
  }

  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [flight.longitude, flight.latitude]
        },
        properties: {
          id: flight.id
        }
      }
    ]
  };
}

function buildHoverFeatureCollection(flight: FlightSummary | null): GeoJSON.FeatureCollection<GeoJSON.Point> {
  if (!flight) {
    return emptyFeatureCollection<GeoJSON.Point>();
  }

  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [flight.longitude, flight.latitude]
        },
        properties: {
          id: flight.id
        }
      }
    ]
  };
}

function buildLineCollection(coordinates: LngLatTuple[]): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  if (coordinates.length < 2) {
    return emptyFeatureCollection<GeoJSON.LineString>();
  }

  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates
        },
        properties: {}
      }
    ]
  };
}

function buildAirportFeatureCollection(detail: FlightDetail | null): GeoJSON.FeatureCollection<GeoJSON.Point> {
  if (!detail) {
    return emptyFeatureCollection<GeoJSON.Point>();
  }

  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [detail.origin.longitude, detail.origin.latitude]
        },
        properties: {
          role: "origin",
          code: detail.origin.iata
        }
      },
      {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [detail.destination.longitude, detail.destination.latitude]
        },
        properties: {
          role: "destination",
          code: detail.destination.iata
        }
      }
    ]
  };
}

function buildCursorFeatureCollection(coordinate: LngLatTuple | null): GeoJSON.FeatureCollection<GeoJSON.Point> {
  if (!coordinate) {
    return emptyFeatureCollection<GeoJSON.Point>();
  }

  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: coordinate
        },
        properties: {}
      }
    ]
  };
}

function interpolateCoordinate(coordinates: LngLatTuple[], progress: number): LngLatTuple | null {
  if (coordinates.length < 2) {
    return coordinates[0] ?? null;
  }

  const scaled = progress * (coordinates.length - 1);
  const fromIndex = Math.floor(scaled);
  const toIndex = Math.min(fromIndex + 1, coordinates.length - 1);
  const alpha = scaled - fromIndex;
  const from = coordinates[fromIndex];
  const to = coordinates[toIndex];

  return [from[0] + (to[0] - from[0]) * alpha, from[1] + (to[1] - from[1]) * alpha];
}

function createCountryBounds(flights: FlightSummary[]): LngLatBoundsLike | null {
  if (flights.length === 0) {
    return null;
  }

  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  flights.forEach((flight) => {
    minLng = Math.min(minLng, flight.longitude);
    minLat = Math.min(minLat, flight.latitude);
    maxLng = Math.max(maxLng, flight.longitude);
    maxLat = Math.max(maxLat, flight.latitude);
  });

  return [
    [minLng, minLat],
    [maxLng, maxLat]
  ];
}

function addMapLayers(map: MapLibreMap) {
  map.addSource(FLIGHTS_SOURCE_ID, {
    type: "geojson",
    data: emptyFeatureCollection<GeoJSON.Point>()
  });
  map.addSource(SELECTED_SOURCE_ID, {
    type: "geojson",
    data: emptyFeatureCollection<GeoJSON.Point>()
  });
  map.addSource(HOVER_SOURCE_ID, {
    type: "geojson",
    data: emptyFeatureCollection<GeoJSON.Point>()
  });
  map.addSource(TRAIL_SOURCE_ID, {
    type: "geojson",
    data: emptyFeatureCollection<GeoJSON.LineString>()
  });
  map.addSource(PROJECTION_SOURCE_ID, {
    type: "geojson",
    data: emptyFeatureCollection<GeoJSON.LineString>()
  });
  map.addSource(AIRPORT_SOURCE_ID, {
    type: "geojson",
    data: emptyFeatureCollection<GeoJSON.Point>()
  });
  map.addSource(CURSOR_SOURCE_ID, {
    type: "geojson",
    data: emptyFeatureCollection<GeoJSON.Point>()
  });

  map.addLayer({
    id: "flight-projection",
    type: "line",
    source: PROJECTION_SOURCE_ID,
    paint: {
      "line-color": "#161a1f",
      "line-width": ["interpolate", ["linear"], ["zoom"], 2, 1.2, 6, 2.2, 10, 3.4],
      "line-opacity": 0.72,
      "line-dasharray": [3, 2]
    }
  });

  map.addLayer({
    id: "flight-trail",
    type: "line",
    source: TRAIL_SOURCE_ID,
    paint: {
      "line-color": "#06080a",
      "line-width": ["interpolate", ["linear"], ["zoom"], 2, 1.6, 6, 2.8, 10, 4.2],
      "line-opacity": 0.92
    }
  });

  map.addLayer({
    id: "flight-points",
    type: "circle",
    source: FLIGHTS_SOURCE_ID,
    paint: {
      "circle-color": [
        "match",
        ["get", "tone"],
        "ground",
        "#ffd36d",
        "climbing",
        "#81d5fa",
        "descending",
        "#81d5fa",
        "approach",
        "#ff7e83",
        "#5ef4cd"
      ],
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 1.8, 4, 2.6, 7, 4.2, 10, 6.4],
      "circle-opacity": 0.92,
      "circle-stroke-width": 1,
      "circle-stroke-color": "rgba(118, 126, 136, 0.88)",
      "circle-stroke-opacity": 0.92
    }
  });

  map.addLayer({
    id: "hover-flight-glow",
    type: "circle",
    source: HOVER_SOURCE_ID,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 8, 4, 10, 7, 14, 10, 18],
      "circle-color": "rgba(255,255,255,0.14)",
      "circle-stroke-width": 1,
      "circle-stroke-color": "rgba(255,255,255,0.82)",
      "circle-radius-transition": {
        duration: 160,
        delay: 0
      },
      "circle-opacity-transition": {
        duration: 160,
        delay: 0
      }
    }
  });

  map.addLayer({
    id: "hover-flight-core",
    type: "circle",
    source: HOVER_SOURCE_ID,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 3.6, 4, 5.2, 7, 8.4, 10, 12.8],
      "circle-color": "#ffffff",
      "circle-stroke-width": 1,
      "circle-stroke-color": "rgba(118, 126, 136, 0.92)",
      "circle-radius-transition": {
        duration: 160,
        delay: 0
      },
      "circle-opacity-transition": {
        duration: 160,
        delay: 0
      }
    }
  });

  map.addLayer({
    id: "selected-flight-glow",
    type: "circle",
    source: SELECTED_SOURCE_ID,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, 7, 7, 11, 11, 16],
      "circle-color": "rgba(255,255,255,0.12)",
      "circle-stroke-width": 1,
      "circle-stroke-color": "#ffffff"
    }
  });

  map.addLayer({
    id: "selected-flight-core",
    type: "circle",
    source: SELECTED_SOURCE_ID,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, 2.3, 7, 3.8, 11, 5.5],
      "circle-color": "#ffffff"
    }
  });

  map.addLayer({
    id: "airport-points",
    type: "circle",
    source: AIRPORT_SOURCE_ID,
    paint: {
      "circle-radius": ["case", ["==", ["get", "role"], "origin"], 5.5, 5.5],
      "circle-color": ["case", ["==", ["get", "role"], "origin"], "#5ef4cd", "#81d5fa"],
      "circle-stroke-width": 1.25,
      "circle-stroke-color": "rgba(255,255,255,0.8)"
    }
  });

  map.addLayer({
    id: "airport-labels",
    type: "symbol",
    source: AIRPORT_SOURCE_ID,
    layout: {
      "text-field": ["get", "code"],
      "text-size": 11,
      "text-offset": [0, 1.1],
      "text-anchor": "top",
      "text-font": ["Open Sans Semibold"]
    },
    paint: {
      "text-color": "#ecfbf6",
      "text-halo-width": 1,
      "text-halo-color": "rgba(3,9,14,0.9)"
    }
  });

  map.addLayer({
    id: "route-cursor",
    type: "circle",
    source: CURSOR_SOURCE_ID,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, 3.5, 7, 5, 11, 6.8],
      "circle-color": "#ffffff",
      "circle-stroke-width": 1,
      "circle-stroke-color": "#81d5fa"
    }
  });
}

export function FlightMap({
  flights,
  focusFlights,
  selectedFlight,
  selectedDetail,
  onSelectFlight,
  refreshing,
  activeCountry
}: FlightMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const flightsRef = useRef<FlightSummary[]>([]);
  const focusFlightsRef = useRef<FlightSummary[]>([]);
  const selectedFlightRef = useRef<FlightSummary | null>(null);
  const selectedDetailRef = useRef<FlightDetail | null>(null);
  const activeCountryRef = useRef<string | null>(null);
  const readyRef = useRef(false);
  const activeKeysRef = useRef(new Set<string>());
  const routeCoordinatesRef = useRef<LngLatTuple[]>([]);
  const frameRef = useRef<number | null>(null);
  const hasFocusedCountryRef = useRef<string | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);

  useEffect(() => {
    flightsRef.current = flights;
  }, [flights]);

  useEffect(() => {
    focusFlightsRef.current = focusFlights;
  }, [focusFlights]);

  useEffect(() => {
    selectedFlightRef.current = selectedFlight;
  }, [selectedFlight]);

  useEffect(() => {
    selectedDetailRef.current = selectedDetail;
  }, [selectedDetail]);

  useEffect(() => {
    activeCountryRef.current = activeCountry;
  }, [activeCountry]);

  useEffect(() => {
    const container = containerRef.current;

    if (!container || mapRef.current) {
      return undefined;
    }

    ensurePmtilesProtocol();

    const map = new maplibregl.Map({
      container,
      style: DEFAULT_STYLE_URL,
      center: [12, 20],
      zoom: 1.35,
      minZoom: 1,
      maxZoom: 14,
      attributionControl: false
    });

    mapRef.current = map;
    popupRef.current = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 12,
      className: "flight-tooltip-popup"
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;

      if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) {
        return;
      }

      if (["KeyW", "KeyA", "KeyS", "KeyD"].includes(event.code)) {
        activeKeysRef.current.add(event.code);
        event.preventDefault();
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      activeKeysRef.current.delete(event.code);
    };

    map.on("load", () => {
      readyRef.current = true;
      addMapLayers(map);
      getSource(map, FLIGHTS_SOURCE_ID)?.setData(buildFlightFeatureCollection(flightsRef.current));
      getSource(map, SELECTED_SOURCE_ID)?.setData(buildSelectedFeatureCollection(selectedFlightRef.current));
      getSource(map, HOVER_SOURCE_ID)?.setData(emptyFeatureCollection<GeoJSON.Point>());
      getSource(map, AIRPORT_SOURCE_ID)?.setData(buildAirportFeatureCollection(selectedDetailRef.current));

      const initialTrail = selectedDetailRef.current ? buildTrailCoordinates(selectedDetailRef.current) : [];
      const initialProjection = selectedDetailRef.current ? buildPredictionCoordinates(selectedDetailRef.current) : [];
      routeCoordinatesRef.current = initialTrail.length > 1 ? initialTrail : initialProjection;
      getSource(map, TRAIL_SOURCE_ID)?.setData(buildLineCollection(initialTrail));
      getSource(map, PROJECTION_SOURCE_ID)?.setData(buildLineCollection(initialProjection));
      getSource(map, CURSOR_SOURCE_ID)?.setData(emptyFeatureCollection<GeoJSON.Point>());

      map.on("mouseenter", "flight-points", () => {
        map.getCanvas().style.cursor = "pointer";
      });

      map.on("mousemove", "flight-points", (event) => {
        const id = event.features?.[0]?.properties?.id as string | undefined;

        if (!id) {
          getSource(map, HOVER_SOURCE_ID)?.setData(emptyFeatureCollection<GeoJSON.Point>());
          popupRef.current?.remove();
          return;
        }

        const flight = flightsRef.current.find((item) => item.id === id) ?? null;
        getSource(map, HOVER_SOURCE_ID)?.setData(buildHoverFeatureCollection(flight));

        if (flight) {
          popupRef.current
            ?.setLngLat([flight.longitude, flight.latitude])
            .setHTML(
              `<div class="flight-tooltip">
                <strong>${flight.callsign}</strong>
                <span>${flight.altitudeFt.toLocaleString()} ft</span>
                <span>${flight.groundSpeedKts} kts</span>
              </div>`
            )
            .addTo(map);
        }
      });

      map.on("mouseleave", "flight-points", () => {
        map.getCanvas().style.cursor = "";
        getSource(map, HOVER_SOURCE_ID)?.setData(emptyFeatureCollection<GeoJSON.Point>());
        popupRef.current?.remove();
      });

      map.on("click", "flight-points", (event) => {
        const id = event.features?.[0]?.properties?.id as string | undefined;

        if (!id) {
          return;
        }

        const flight = flightsRef.current.find((item) => item.id === id);

        if (flight) {
          onSelectFlight(flight);
        }
      });

      if (activeCountryRef.current) {
        const bounds = createCountryBounds(focusFlightsRef.current);

        if (bounds) {
          map.fitBounds(bounds, {
            padding: 80,
            duration: 0,
            maxZoom: 6.8
          });
          hasFocusedCountryRef.current = activeCountryRef.current;
        }
      }
    });

    let lastFrame = performance.now();

    const tick = (now: number) => {
      const liveMap = mapRef.current;

      if (liveMap) {
        const delta = now - lastFrame;
        lastFrame = now;
        const step = 0.35 * delta;
        let panX = 0;
        let panY = 0;

        if (activeKeysRef.current.has("KeyW")) {
          panY -= step;
        }
        if (activeKeysRef.current.has("KeyS")) {
          panY += step;
        }
        if (activeKeysRef.current.has("KeyA")) {
          panX -= step;
        }
        if (activeKeysRef.current.has("KeyD")) {
          panX += step;
        }

        if (panX !== 0 || panY !== 0) {
          liveMap.panBy([panX, panY], { animate: false });
        }

        if (readyRef.current && routeCoordinatesRef.current.length > 1) {
          const progress = ((now / 1000) * 0.22) % 1;
          const coordinate = interpolateCoordinate(routeCoordinatesRef.current, progress);
          getSource(liveMap, CURSOR_SOURCE_ID)?.setData(buildCursorFeatureCollection(coordinate));
        }
      }

      frameRef.current = window.requestAnimationFrame(tick);
    };

    frameRef.current = window.requestAnimationFrame(tick);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
      }
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      popupRef.current?.remove();
      popupRef.current = null;
      map.remove();
      mapRef.current = null;
      readyRef.current = false;
    };
  }, [onSelectFlight]);

  useEffect(() => {
    const map = mapRef.current;

    if (!map || !readyRef.current) {
      return;
    }

    getSource(map, FLIGHTS_SOURCE_ID)?.setData(buildFlightFeatureCollection(flights));
  }, [flights]);

  useEffect(() => {
    const map = mapRef.current;

    if (!map || !readyRef.current) {
      return;
    }

    getSource(map, SELECTED_SOURCE_ID)?.setData(buildSelectedFeatureCollection(selectedFlight));
  }, [selectedFlight]);

  useEffect(() => {
    const map = mapRef.current;

    if (!map || !readyRef.current) {
      return;
    }

    const trailCoordinates = selectedDetail ? buildTrailCoordinates(selectedDetail) : [];
    const predictionCoordinates = selectedDetail ? buildPredictionCoordinates(selectedDetail) : [];

    routeCoordinatesRef.current = trailCoordinates.length > 1 ? trailCoordinates : predictionCoordinates;
    getSource(map, TRAIL_SOURCE_ID)?.setData(buildLineCollection(trailCoordinates));
    getSource(map, PROJECTION_SOURCE_ID)?.setData(buildLineCollection(predictionCoordinates));
    getSource(map, AIRPORT_SOURCE_ID)?.setData(buildAirportFeatureCollection(selectedDetail));

    if (routeCoordinatesRef.current.length < 2) {
      getSource(map, CURSOR_SOURCE_ID)?.setData(emptyFeatureCollection<GeoJSON.Point>());
    }
  }, [selectedDetail]);

  useEffect(() => {
    const map = mapRef.current;

    if (!map || !readyRef.current) {
      return;
    }

    if (!activeCountry) {
      if (hasFocusedCountryRef.current !== null) {
        map.easeTo({
          center: [12, 20],
          zoom: 1.35,
          duration: 800
        });
      }

      hasFocusedCountryRef.current = null;
      return;
    }

    if (hasFocusedCountryRef.current === activeCountry) {
      return;
    }

    const bounds = createCountryBounds(focusFlights);

    if (bounds) {
      map.fitBounds(bounds, {
        padding: 80,
        duration: 900,
        maxZoom: 6.8
      });
      hasFocusedCountryRef.current = activeCountry;
    }
  }, [activeCountry, focusFlights]);

  return (
    <section className="map-shell">
      <header className="map-header">
        <div>
          <p className="eyebrow">World Airspace</p>
          <h2>MapLibre vector airspace</h2>
        </div>
        <div className="map-actions">
          <span className={refreshing ? "chip chip-live is-refreshing" : "chip chip-live"}>
            {refreshing ? "Refreshing feed" : "Live feed stable"}
          </span>
          <span className="chip">Vector map / city zoom</span>
        </div>
      </header>

      <div className="map-frame map-frame-maplibre">
        <div ref={containerRef} className="maplibre-host" aria-label="Global live flight map" />

        <div className="map-overlay overlay-top-left">
          <span className="overlay-label">Live density</span>
          <strong>{flights.length.toLocaleString()} tracks</strong>
        </div>
        <div className="map-overlay overlay-top-right">
          <span className="overlay-label">Controls</span>
          <strong>Wheel / drag / WASD</strong>
        </div>
        <div className="map-overlay overlay-bottom-left">
          <div className="legend">
            <span className="legend-item">
              <i className="legend-dot cruise" />
              Cruise
            </span>
            <span className="legend-item">
              <i className="legend-dot climbing" />
              Climb / Descend
            </span>
            <span className="legend-item">
              <i className="legend-dot ground" />
              Ground
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
