import { EARTH_EQUATORIAL_RADIUS_KM } from "./orbit.js";

/**
 * The WGS84 ellipsoid as satellite.js reads a geodetic sub-point and places
 * an Observer on it (`eciToGeodetic`, `geodeticToEcf`), in kilometres: the
 * one statement of it, exported so that a caller's own arithmetic (an In
 * view count written without the engine's allocations, a velocity converted
 * to degrees) stands on the ellipsoid the engine does.
 */
export const WGS84_EQUATORIAL_KM = EARTH_EQUATORIAL_RADIUS_KM;
export const WGS84_POLAR_KM = 6356.7523142;
/** The square of its first eccentricity. */
export const WGS84_E2 = 1 - (WGS84_POLAR_KM / WGS84_EQUATORIAL_KM) ** 2;

/**
 * The ellipsoid's two radii of curvature at a geodetic latitude, in
 * kilometres: along the meridian, and the prime vertical's, square to it,
 * which is the distance along the normal from the surface to the polar
 * axis. A degree of latitude there is the first's, and a degree of
 * longitude the second's times the cosine of the latitude.
 */
export function radiiOfCurvatureKm(latitudeRadians: number): { meridian: number; primeVertical: number } {
  const sine = Math.sin(latitudeRadians);
  const stretch = 1 - WGS84_E2 * sine * sine;
  const primeVertical = WGS84_EQUATORIAL_KM / Math.sqrt(stretch);
  return { meridian: (primeVertical * (1 - WGS84_E2)) / stretch, primeVertical };
}
