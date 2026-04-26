import { geoInterpolate } from "d3-geo";
import type { GeoProjection } from "d3-geo";
import type { FlightDetail, FlightRoutePoint } from "../types/flight";

export interface ProjectedPoint {
  x: number;
  y: number;
}

function projectPoint(projection: GeoProjection, longitude: number, latitude: number): ProjectedPoint | null {
  const projected = projection([longitude, latitude]);

  if (!projected) {
    return null;
  }

  return {
    x: projected[0],
    y: projected[1]
  };
}

function buildSvgPath(points: ProjectedPoint[]): string {
  if (points.length === 0) {
    return "";
  }

  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");
}

export function buildTrailPath(detail: FlightDetail, projection: GeoProjection): string {
  const points = detail.trail
    .map((point) => projectPoint(projection, point.lng, point.lat))
    .filter((point): point is ProjectedPoint => point !== null);

  return buildSvgPath(points.reverse());
}

export function buildPredictionPath(detail: FlightDetail, projection: GeoProjection): string {
  const startPoint = detail.trail[0] ?? {
    lat: detail.origin.latitude,
    lng: detail.origin.longitude
  };

  const interpolator = geoInterpolate(
    [startPoint.lng, startPoint.lat],
    [detail.destination.longitude, detail.destination.latitude]
  );

  const points: FlightRoutePoint[] = Array.from({ length: 32 }, (_, index) => {
    const [lng, lat] = interpolator(index / 31);
    return { lat, lng };
  });

  const projected = points
    .map((point) => projectPoint(projection, point.lng, point.lat))
    .filter((point): point is ProjectedPoint => point !== null);

  return buildSvgPath(projected);
}

export function projectAirport(
  projection: GeoProjection,
  longitude: number,
  latitude: number
): ProjectedPoint | null {
  return projectPoint(projection, longitude, latitude);
}
