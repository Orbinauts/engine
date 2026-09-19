import { degreesLat, degreesLong, eciToGeodetic, gstime, propagate as sgp4Propagate, type GeodeticLocation, type SatRec } from "satellite.js";
import { toRadians } from "./angles.js";
import { toSatRec, type Elements } from "./elements.js";

/** A point on the ground. */
export interface GroundPoint {
  /** Degrees north. */
  latitude: number;
  /** Degrees east, in [-180, 180]. */
  longitude: number;
}

/** Where a Satellite is at one instant: the point beneath it and its altitude. */
export interface Position extends GroundPoint {
  /** Kilometres above the WGS84 ellipsoid. */
  altitude: number;
}

/** An exact point on Earth from which the sky is evaluated. */
export interface Observer extends GroundPoint {
  /** Metres above the WGS84 ellipsoid. */
  altitude: number;
}

/**
 * The Observer as satellite.js wants a site: radians and kilometres, where
 * an Observer is degrees and metres. Written once because getting either
 * conversion wrong moves the horizon, and both the Pass search and In view
 * ask for the same look angles from it.
 */
export function observerSite(observer: Observer): GeodeticLocation {
  return {
    latitude: toRadians(observer.latitude),
    longitude: toRadians(observer.longitude),
    height: observer.altitude / 1000,
  };
}

export class PropagationError extends Error {}

/** The Position propagated from the Elements at the instant. */
export function propagate(elements: Elements, at: Date): Position {
  return propagateSatRec(toSatRec(elements), at);
}

export function propagateSatRec(satrec: SatRec, at: Date): Position {
  return positionOf(eciToGeodetic(propagateState(satrec, at).position, gstime(at)));
}

/** The Position at a geodetic sub-point as satellite.js gives it (radians and kilometres), or a PropagationError where SGP4 answered numbers that are none. */
export function positionOf(geodetic: GeodeticLocation): Position {
  if (!Number.isFinite(geodetic.latitude + geodetic.longitude + geodetic.height)) {
    throw new PropagationError("propagation produced a non-finite Position");
  }
  return {
    latitude: degreesLat(geodetic.latitude),
    longitude: degreesLong(geodetic.longitude),
    altitude: geodetic.height,
  };
}

/** The Satellite's speed along its orbit at the instant, in kilometres per second. */
export function orbitalSpeed(elements: Elements, at: Date): number {
  const { velocity } = propagateState(toSatRec(elements), at);
  return Math.hypot(velocity.x, velocity.y, velocity.z);
}

/** The inertial (TEME) position and velocity vectors from SGP4, or a PropagationError. */
export function propagateState(satrec: SatRec, at: Date) {
  const state = sgp4Propagate(satrec, at);
  if (state === null || typeof state.position === "boolean" || typeof state.velocity === "boolean") {
    throw new PropagationError(`propagation failed with satellite.js error ${satrec.error}`);
  }
  return { position: state.position, velocity: state.velocity };
}
