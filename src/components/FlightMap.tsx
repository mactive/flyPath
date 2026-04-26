import { geoGraticule10, geoNaturalEarth1, geoPath, type GeoProjection } from "d3-geo";
import { feature, mesh } from "topojson-client";
import worldAtlas from "world-atlas/countries-110m.json";
import { useMemo } from "react";
import { buildPredictionPath, buildTrailPath, projectAirport } from "../utils/geo";
import type { FlightDetail, FlightSummary } from "../types/flight";

const width = 1320;
const height = 720;
const atlas = worldAtlas as unknown as {
  objects: {
    countries: object;
  };
};

const countriesData = feature(
  atlas as never,
  atlas.objects.countries as never
) as unknown as GeoJSON.FeatureCollection;
const countryBorders = mesh(
  atlas as never,
  atlas.objects.countries as never,
  (left: { id?: string | number }, right: { id?: string | number }) => left.id !== right.id
) as unknown as GeoJSON.MultiLineString;

interface FlightMapProps {
  flights: FlightSummary[];
  selectedFlight: FlightSummary | null;
  selectedDetail: FlightDetail | null;
  onSelectFlight: (flight: FlightSummary) => void;
  refreshing: boolean;
}

function buildProjection(): GeoProjection {
  return geoNaturalEarth1()
    .fitExtent(
      [
        [20, 24],
        [width - 20, height - 24]
      ],
      { type: "Sphere" }
    )
    .precision(0.1);
}

export function FlightMap({
  flights,
  selectedFlight,
  selectedDetail,
  onSelectFlight,
  refreshing
}: FlightMapProps) {
  const projection = useMemo(() => buildProjection(), []);
  const mapPath = useMemo(() => geoPath(projection), [projection]);
  const graticulePath = useMemo(() => mapPath(geoGraticule10()) || "", [mapPath]);
  const countriesPath = useMemo(() => mapPath(countriesData) || "", [mapPath]);
  const borderPath = useMemo(() => mapPath(countryBorders) || "", [mapPath]);

  const projectedFlights = useMemo(
    () =>
      flights
        .map((flight) => {
          const projected = projection([flight.longitude, flight.latitude]);

          if (!projected) {
            return null;
          }

          return {
            ...flight,
            x: projected[0],
            y: projected[1]
          };
        })
        .filter((flight): flight is FlightSummary & { x: number; y: number } => flight !== null),
    [flights, projection]
  );

  const trailPath = useMemo(() => {
    if (!selectedDetail) {
      return "";
    }

    return buildTrailPath(selectedDetail, projection);
  }, [projection, selectedDetail]);

  const predictionPath = useMemo(() => {
    if (!selectedDetail) {
      return "";
    }

    return buildPredictionPath(selectedDetail, projection);
  }, [projection, selectedDetail]);

  const originMarker = useMemo(() => {
    if (!selectedDetail) {
      return null;
    }

    return projectAirport(projection, selectedDetail.origin.longitude, selectedDetail.origin.latitude);
  }, [projection, selectedDetail]);

  const destinationMarker = useMemo(() => {
    if (!selectedDetail) {
      return null;
    }

    return projectAirport(projection, selectedDetail.destination.longitude, selectedDetail.destination.latitude);
  }, [projection, selectedDetail]);

  return (
    <section className="map-shell">
      <header className="map-header">
        <div>
          <p className="eyebrow">World Airspace</p>
          <h2>2D tactical flight surface</h2>
        </div>
        <div className="map-actions">
          <span className={refreshing ? "chip chip-live is-refreshing" : "chip chip-live"}>
            {refreshing ? "Refreshing feed" : "Live feed stable"}
          </span>
          <span className="chip">Natural Earth / 2D</span>
        </div>
      </header>

      <div className="map-frame">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Global live flight map">
          <defs>
            <linearGradient id="trail-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="rgba(94, 244, 205, 0.05)" />
              <stop offset="55%" stopColor="rgba(94, 244, 205, 0.88)" />
              <stop offset="100%" stopColor="rgba(129, 213, 250, 1)" />
            </linearGradient>
            <linearGradient id="projection-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="rgba(129, 213, 250, 0.04)" />
              <stop offset="100%" stopColor="rgba(129, 213, 250, 0.5)" />
            </linearGradient>
            <filter id="flight-glow">
              <feGaussianBlur stdDeviation="2.8" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <rect className="map-ocean" width={width} height={height} rx="20" />
          <path d={graticulePath} className="map-graticule" />
          <path d={countriesPath} className="map-land" />
          <path d={borderPath} className="map-borders" />

          {predictionPath && <path d={predictionPath} className="route-prediction" />}
          {trailPath && <path d={trailPath} className="route-trail" />}

          {originMarker && (
            <g transform={`translate(${originMarker.x}, ${originMarker.y})`} className="airport-marker">
              <circle r="7.5" />
              <circle r="2.8" className="airport-core" />
            </g>
          )}

          {destinationMarker && (
            <g transform={`translate(${destinationMarker.x}, ${destinationMarker.y})`} className="airport-marker">
              <circle r="7.5" />
              <circle r="2.8" className="airport-core destination" />
            </g>
          )}

          {projectedFlights.map((flight) => {
            const isSelected = selectedFlight?.id === flight.id;

            return (
              <g
                key={flight.id + flight.lastContact}
                transform={`translate(${flight.x}, ${flight.y})`}
                className={`flight-point tone-${flight.tone} ${isSelected ? "is-selected" : ""}`}
                onClick={() => onSelectFlight(flight)}
              >
                <circle className="flight-hitbox" r="8.5" />
                <circle className="flight-glow" r={isSelected ? 5.6 : 3.8} filter="url(#flight-glow)" />
                <circle className="flight-core" r={isSelected ? 3.1 : 1.9} />
                {isSelected && <circle className="flight-pulse" r="9" />}
                <title>
                  {flight.callsign} · {flight.country} · {flight.statusLabel}
                </title>
              </g>
            );
          })}
        </svg>

        <div className="map-overlay overlay-top-left">
          <span className="overlay-label">Scroll density</span>
          <strong>{projectedFlights.length.toLocaleString()} tracks</strong>
        </div>
        <div className="map-overlay overlay-top-right">
          <span className="overlay-label">Interaction</span>
          <strong>Click any aircraft</strong>
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
