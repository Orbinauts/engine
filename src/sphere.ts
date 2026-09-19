import { toDegrees, toRadians, wrapLongitude } from "./angles.js";

/**
 * The round Earth the engine measures along the ground on: its mean radius,
 * the angle at its centre between two points and the way one point lies
 * from another. What a Footprint's reach and a Ground track's sampling are
 * said by, and exported so that a caller measuring its own distances on the
 * ground (how far a Satellite passes from a city, which city is nearest)
 * measures with the same ruler. Imports nothing but the angles' own helpers, which
 * import nothing, so a bundle that reads only these functions from the
 * package's one entry takes nothing else along.
 */

/** A point on the Earth, in degrees. */
export interface SpherePoint {
  latitude: number;
  longitude: number;
}

/** The Earth's mean radius in kilometres (IUGG). */
export const EARTH_MEAN_RADIUS_KM = 6_371.0088;


/** The angle at the Earth's centre between two points, in radians: the haversine, which keeps its digits at small separations where the law of cosines loses them. */
export function centralAngle(from: SpherePoint, to: SpherePoint): number {
  const half = (degrees: number) => Math.sin(toRadians(degrees) / 2) ** 2;
  const cosines = Math.cos(toRadians(from.latitude)) * Math.cos(toRadians(to.latitude));
  return 2 * Math.asin(Math.min(1, Math.sqrt(half(to.latitude - from.latitude) + cosines * half(to.longitude - from.longitude))));
}

/** The same angle in degrees. */
export function separationDegrees(from: SpherePoint, to: SpherePoint): number {
  return (centralAngle(from, to) * 180) / Math.PI;
}

/** The distance between two points along the round Earth's surface, in kilometres. */
export function greatCircleKm(from: SpherePoint, to: SpherePoint): number {
  return centralAngle(from, to) * EARTH_MEAN_RADIUS_KM;
}

/** The way one point lies from another: the initial bearing of the great circle between them, in degrees clockwise from north in [0, 360), across the antimeridian too. */
export function initialBearingDegrees(from: SpherePoint, to: SpherePoint): number {
  const [φ1, φ2, Δλ] = [toRadians(from.latitude), toRadians(to.latitude), toRadians(to.longitude - from.longitude)];
  const degrees = (Math.atan2(Math.sin(Δλ) * Math.cos(φ2), Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)) * 180) / Math.PI;
  return ((degrees % 360) + 360) % 360;
}

/** The point so many kilometres from another along the great circle leaving it on a bearing, degrees clockwise from north, its longitude in [-180, 180]. */
export function destinationPoint(from: SpherePoint, bearingDegrees: number, km: number): SpherePoint {
  const [φ1, λ1, θ, δ] = [toRadians(from.latitude), toRadians(from.longitude), toRadians(bearingDegrees), km / EARTH_MEAN_RADIUS_KM];
  const φ2 = Math.asin(Math.min(1, Math.max(-1, Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ))));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return { latitude: toDegrees(φ2), longitude: wrapLongitude(toDegrees(λ2)) };
}
