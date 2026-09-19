import { eciToEcf, eciToGeodetic, gstime, type EciVec3, type GeodeticLocation } from "satellite.js";
import { toDegrees, wrapAzimuth } from "./angles.js";
import { toSatRec, type Elements } from "./elements.js";
import { isGeostationary } from "./geostationary.js";
import { EARTH_ROTATION_RAD_PER_S } from "./orbit.js";
import { propagateState } from "./position.js";
import { radiiOfCurvatureKm } from "./wgs84.js";

/**
 * The Course: the direction the point beneath a Satellite moves
 * over the ground at an instant, in degrees clockwise from north. It is the
 * motion over the turning Earth and not through space: a Satellite on a
 * prograde orbit that flies north-east against the stars crosses the ground
 * a little further north, since the ground turns east beneath it, and a
 * Geostationary one, which flies east at 3 km/s, crosses no ground at all.
 *
 * Nothing for Elements the engine reads as Geostationary: their sub-point
 * stands, and the drift of a few metres a second round the small figure it
 * keeps to is no Course anyone could be shown.
 */
export function course(elements: Elements, at: Date): number | undefined {
  if (isGeostationary(elements)) return undefined;
  const { position, velocity } = propagateState(toSatRec(elements), at);
  const gmst = gstime(at);
  return courseOf(groundVelocity(position, velocity, gmst, eciToGeodetic(position, gmst)));
}

/**
 * How fast the point beneath a Body moves over the ground, along the local
 * north and east at that point, in kilometres a second: what the Course is
 * the direction of, and what a map can carry a marker along between the
 * instants it propagates.
 */
export interface GroundVelocity {
  north: number;
  east: number;
}

/** The Course of a velocity over the ground, in degrees clockwise from north. */
export function courseOf({ north, east }: GroundVelocity): number {
  return wrapAzimuth(toDegrees(Math.atan2(east, north)));
}

/**
 * The velocity over the ground of the sub-point of a Body at an inertial
 * (TEME) position and velocity, given the Greenwich sidereal angle of the
 * instant and the geodetic sub-point already read from that position.
 */
export function groundVelocity(position: EciVec3<number>, velocity: EciVec3<number>, gmst: number, { latitude, longitude, height }: GeodeticLocation): GroundVelocity {
  // The velocity over the ground: the inertial one turned into the
  // Earth-fixed frame, less the speed of that frame itself where the
  // Satellite is (the Earth's turning, crossed with its position).
  const fixed = eciToEcf(position, gmst);
  const turned = eciToEcf(velocity, gmst);
  const vx = turned.x + EARTH_ROTATION_RAD_PER_S * fixed.y;
  const vy = turned.y - EARTH_ROTATION_RAD_PER_S * fixed.x;
  const vz = turned.z;
  // Its parts along the local north and east, at the geodetic sub-point.
  const [sinLat, cosLat, sinLon, cosLon] = [Math.sin(latitude), Math.cos(latitude), Math.sin(longitude), Math.cos(longitude)];
  const north = -sinLat * cosLon * vx - sinLat * sinLon * vy + cosLat * vz;
  const east = -sinLon * vx + cosLon * vy;
  // The Satellite moves along the ground at its own height, where a degree of
  // latitude and a degree of longitude are both longer than beneath it, and
  // not by the same amount: the ellipsoid curves more tightly along a
  // meridian than along a parallel. Scaled down to the ellipsoid's surface,
  // the two parts are the sub-point's own motion and their angle its Course.
  // The correction reaches a fifth of a degree for a Satellite far out; left
  // out, the engine and Skyfield differ by 0.14 degrees for BeiDou 3 IGSO-1,
  // and with it by 0.013 at worst over every fixture Position.
  const { meridian, primeVertical } = radiiOfCurvatureKm(latitude);
  return { north: (north * meridian) / (meridian + height), east: (east * primeVertical) / (primeVertical + height) };
}
