import { geoInterpolate } from "d3-geo";
import type { FlightDetail, FlightRoutePoint } from "../types/flight";

export type LngLatTuple = [number, number];

export function buildTrailCoordinates(detail: FlightDetail): LngLatTuple[] {
  return detail.trail
    .map((point) => [point.lng, point.lat] as LngLatTuple)
    .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat))
    .reverse();
}

export function buildPredictionCoordinates(detail: FlightDetail): LngLatTuple[] {
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
    .map((point) => [point.lng, point.lat] as LngLatTuple)
    .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat));
}
