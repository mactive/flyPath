import { geoInterpolate } from "d3-geo";
import type { GeoProjection } from "d3-geo";
import type { FlightDetail, FlightRoutePoint } from "../types/flight";

export const MAP_WIDTH = 1320;
export const MAP_HEIGHT = 720;

export interface WorldPoint {
  x: number;
  y: number;
}

export function projectToWorld(projection: GeoProjection, longitude: number, latitude: number): WorldPoint | null {
  const projected = projection([longitude, latitude]);

  if (!projected) {
    return null;
  }

  return {
    x: projected[0] - MAP_WIDTH / 2,
    y: MAP_HEIGHT / 2 - projected[1]
  };
}

export function buildTrailWorldPoints(detail: FlightDetail, projection: GeoProjection): WorldPoint[] {
  return detail.trail
    .map((point) => projectToWorld(projection, point.lng, point.lat))
    .filter((point): point is WorldPoint => point !== null)
    .reverse();
}

export function buildPredictionWorldPoints(detail: FlightDetail, projection: GeoProjection): WorldPoint[] {
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

  return points
    .map((point) => projectToWorld(projection, point.lng, point.lat))
    .filter((point): point is WorldPoint => point !== null);
}

export function projectAirport(
  projection: GeoProjection,
  longitude: number,
  latitude: number
): WorldPoint | null {
  return projectToWorld(projection, longitude, latitude);
}
