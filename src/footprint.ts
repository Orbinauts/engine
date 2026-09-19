import { toDegrees, toRadians, wrapLongitude } from "./angles.js";
import type { GroundPoint, Position } from "./position.js";
import { EARTH_MEAN_RADIUS_KM } from "./sphere.js";

export { wrapLongitude };

/**
 * The Footprint radius: kilometres along the ground from the point beneath
 * a Satellite to the horizon seen from its altitude, on a spherical Earth.
 * Given an elevation, the reach narrows to where the Satellite stands at
 * least that high above the horizon: ten degrees is where it clears the
 * buildings, the hills and the haze a real horizon has, the reach within
 * which someone looking up can actually see it.
 */
export function footprintRadiusKm(altitudeKm: number, elevationDegrees = 0): number {
  return EARTH_MEAN_RADIUS_KM * footprintAngle(altitudeKm, elevationDegrees);
}

/**
 * The same reach as the angle at the centre of the Earth that subtends it,
 * in degrees, rather than as a distance along the ground: the Footprint is
 * a spherical cap, and this is its angular radius, the form every
 * calculation on the sphere takes it in.
 */
export function footprintAngleDegrees(altitudeKm: number, elevationDegrees = 0): number {
  return toDegrees(footprintAngle(altitudeKm, elevationDegrees));
}

/**
 * The band of latitudes a Satellite of this inclination and altitude can be
 * seen from, in degrees north and south of the equator: how far the
 * Footprint reaches past the furthest the Satellite's own ground track ever
 * goes. Given an elevation, the reach is the one that clears a real
 * horizon, as the Footprint radius is.
 *
 * The furthest north or south the point beneath a Satellite goes is its
 * inclination, and a retrograde orbit's is what its inclination leaves of
 * half a turn: a sun-synchronous orbit at 98 degrees reaches 82. Beyond
 * that the Satellite is still seen from as far again as the Footprint
 * reaches, which is the half-angle at the centre of the Earth. The whole
 * never passes the pole, so it is capped at 90: such a Satellite is seen
 * from everywhere, and "up to 104 degrees" is not a latitude.
 */
export function latitudeBandDegrees(inclinationDegrees: number, altitudeKm: number, elevationDegrees = 0): number {
  const reach = Math.abs(inclinationDegrees) % 180;
  const furthestSubPoint = reach > 90 ? 180 - reach : reach;
  return Math.min(90, furthestSubPoint + footprintAngleDegrees(altitudeKm, elevationDegrees));
}

/**
 * The Footprint as a ring of ground points, clockwise from due north of the
 * Position, at every point of which the Satellite sits on the horizon.
 */
export function footprint(position: Position, points = 90): GroundPoint[] {
  return groundCircle(position, footprintAngle(position.altitude), points);
}

/**
 * The angle at the centre of the Earth from the Satellite's sub-point to
 * where it stands an elevation above the horizon, its horizon at zero: in
 * the triangle of the Earth's centre, the Observer and the Satellite, the
 * angle at the Observer is a right angle and the elevation, the one at the
 * Satellite is asin(R cos e / (R + h)), and the one at the centre is what
 * the two leave of half a turn.
 */
function footprintAngle(altitudeKm: number, elevationDegrees = 0): number {
  const elevation = toRadians(elevationDegrees);
  return Math.acos((EARTH_MEAN_RADIUS_KM * Math.cos(elevation)) / (EARTH_MEAN_RADIUS_KM + altitudeKm)) - elevation;
}

/** Points at a fixed angular distance from a centre, clockwise from north. */
function groundCircle(centre: GroundPoint, angularRadius: number, points: number): GroundPoint[] {
  const lat = toRadians(centre.latitude);
  const lon = toRadians(centre.longitude);
  const ring: GroundPoint[] = [];
  for (let i = 0; i < points; i++) {
    const bearing = (2 * Math.PI * i) / points;
    const pointLat = Math.asin(Math.sin(lat) * Math.cos(angularRadius) + Math.cos(lat) * Math.sin(angularRadius) * Math.cos(bearing));
    const pointLon =
      lon + Math.atan2(Math.sin(bearing) * Math.sin(angularRadius) * Math.cos(lat), Math.cos(angularRadius) - Math.sin(lat) * Math.sin(pointLat));
    ring.push({ latitude: toDegrees(pointLat), longitude: wrapLongitude(toDegrees(pointLon)) });
  }
  return ring;
}
