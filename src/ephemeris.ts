import { MakeTime, RotateVector, Rotation_EQJ_EQD, SiderealTime, Vector } from "astronomy-engine";
import { degreesLat, degreesLong, eciToGeodetic, type EcfVec3, type EciVec3 } from "satellite.js";
import { toRadians } from "./angles.js";
import type { Interval } from "./ground-track.js";
import { PropagationError, type Position } from "./position.js";

/** The Satellite's state at one instant: position in kilometres and velocity in kilometres per second, in the J2000 frame. */
export interface StateVector {
  at: Date;
  position: EciVec3<number>;
  velocity: EciVec3<number>;
}

/**
 * A table of a Satellite's state over time published by its operator, from
 * which Positions are interpolated rather than propagated. The vectors are
 * in time order; the Ephemeris covers the instants from the first to the
 * last.
 */
export interface Ephemeris {
  /** The operator's identifier for the Satellite: the international designator, as in "1998-067-A". */
  objectId: string;
  objectName: string;
  /** When the operator issued the table. */
  issuedAt: Date;
  vectors: StateVector[];
}

export class EphemerisError extends Error {}

/** The names an OEM file may give the J2000 frame. */
const J2000_FRAMES = new Set(["EME2000", "J2000", "ICRF", "GCRF"]);
/** No Satellite the engine tracks orbits below this radius, in kilometres; a vector inside it is corrupt. */
const MIN_RADIUS_KM = 6400;

const OEM_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/;

/**
 * Reads an Ephemeris from the CCSDS OEM text NASA publishes for the ISS: a
 * header, one metadata block, comments, then one line per state vector.
 * Throws EphemerisError when the text is not such a file, is not in the
 * J2000 frame and UTC, or its vectors are unreadable, out of order or
 * implausible, so that a caller never keeps a corrupt Ephemeris in place of
 * a good one.
 */
export function parseEphemeris(text: string): Ephemeris {
  const fields = new Map<string, string>();
  const vectors: StateVector[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("COMMENT") || line === "META_START" || line === "META_STOP") continue;
    const field = /^([A-Z_]+)\s*=\s*(.*)$/.exec(line);
    if (field !== null) {
      fields.set(field[1]!, field[2]!.trim());
      continue;
    }
    vectors.push(parseVector(line));
  }
  if (!fields.has("CCSDS_OEM_VERS")) throw new EphemerisError("not a CCSDS OEM file");
  const frame = fields.get("REF_FRAME") ?? "";
  if (!J2000_FRAMES.has(frame)) throw new EphemerisError(`reference frame ${frame || "missing"} is not J2000`);
  if ((fields.get("TIME_SYSTEM") ?? "") !== "UTC") throw new EphemerisError("time system is not UTC");
  if ((fields.get("CENTER_NAME") ?? "").toUpperCase() !== "EARTH") throw new EphemerisError("the centre is not the Earth");
  const issuedAt = parseInstant(fields.get("CREATION_DATE") ?? "");
  if (vectors.length < 2) throw new EphemerisError("fewer than two state vectors");
  for (let index = 1; index < vectors.length; index++) {
    if (vectors[index]!.at.getTime() <= vectors[index - 1]!.at.getTime()) {
      throw new EphemerisError(`state vectors are out of order at ${vectors[index]!.at.toISOString()}`);
    }
  }
  return { objectId: fields.get("OBJECT_ID") ?? "", objectName: fields.get("OBJECT_NAME") ?? "", issuedAt, vectors };
}

function parseVector(line: string): StateVector {
  const parts = line.split(/\s+/);
  if (parts.length !== 7) throw new EphemerisError(`unreadable line: ${line.slice(0, 40)}`);
  const at = parseInstant(parts[0]!);
  const [x, y, z, vx, vy, vz] = parts.slice(1).map(Number) as [number, number, number, number, number, number];
  if (!Number.isFinite(x + y + z + vx + vy + vz)) throw new EphemerisError(`unreadable state vector at ${at.toISOString()}`);
  if (Math.hypot(x, y, z) < MIN_RADIUS_KM) throw new EphemerisError(`state vector at ${at.toISOString()} is inside the Earth`);
  return { at, position: { x, y, z }, velocity: { x: vx, y: vy, z: vz } };
}

/** An OEM instant is UTC written without a zone designator. */
function parseInstant(value: string): Date {
  const at = new Date(`${value}Z`);
  if (!OEM_INSTANT.test(value) || Number.isNaN(at.getTime())) throw new EphemerisError(`unreadable instant: ${value}`);
  return at;
}

/** The span from the first vector to the last. */
export function ephemerisInterval(ephemeris: Ephemeris): Interval {
  return { from: ephemeris.vectors[0]!.at, to: ephemeris.vectors[ephemeris.vectors.length - 1]!.at };
}

/** Whether every instant of the interval lies between the first vector and the last. */
export function ephemerisCovers(ephemeris: Ephemeris, interval: Interval): boolean {
  const { from, to } = ephemerisInterval(ephemeris);
  return interval.from.getTime() >= from.getTime() && interval.to.getTime() <= to.getTime();
}

/** The Position interpolated from the Ephemeris at the instant, which it must cover. */
export function interpolate(ephemeris: Ephemeris, at: Date): Position {
  return toPosition(j2000ToEcf(interpolateState(ephemeris, at.getTime()), at));
}

/**
 * The J2000 position at an instant, in kilometres, by cubic Hermite
 * interpolation between the two vectors around it: the cubic through both
 * positions with both velocities. Four minutes apart on a low orbit that
 * is within about 100 m of the true path; NASA's vectors come closer
 * together around a reboost, where the path bends faster.
 */
export function interpolateState(ephemeris: Ephemeris, t: number): EciVec3<number> {
  const { a, b, h, tau } = segmentAt(ephemeris, t);
  const tau2 = tau * tau;
  const tau3 = tau2 * tau;
  const h00 = 2 * tau3 - 3 * tau2 + 1;
  const h10 = (tau3 - 2 * tau2 + tau) * h;
  const h01 = -2 * tau3 + 3 * tau2;
  const h11 = (tau3 - tau2) * h;
  return {
    x: h00 * a.position.x + h10 * a.velocity.x + h01 * b.position.x + h11 * b.velocity.x,
    y: h00 * a.position.y + h10 * a.velocity.y + h01 * b.position.y + h11 * b.velocity.y,
    z: h00 * a.position.z + h10 * a.velocity.z + h01 * b.position.z + h11 * b.velocity.z,
  };
}

/**
 * The J2000 velocity at an instant, in kilometres per second: the derivative
 * of the same cubic, so it is exactly a vector's own velocity at that
 * vector's instant and bends smoothly between two.
 */
export function interpolateVelocity(ephemeris: Ephemeris, t: number): EciVec3<number> {
  const { a, b, h, tau } = segmentAt(ephemeris, t);
  const tau2 = tau * tau;
  // The basis derivatives with respect to tau, divided by h for a rate per second.
  const d00 = (6 * tau2 - 6 * tau) / h;
  const d10 = 3 * tau2 - 4 * tau + 1;
  const d01 = (-6 * tau2 + 6 * tau) / h;
  const d11 = 3 * tau2 - 2 * tau;
  return {
    x: d00 * a.position.x + d10 * a.velocity.x + d01 * b.position.x + d11 * b.velocity.x,
    y: d00 * a.position.y + d10 * a.velocity.y + d01 * b.position.y + d11 * b.velocity.y,
    z: d00 * a.position.z + d10 * a.velocity.z + d01 * b.position.z + d11 * b.velocity.z,
  };
}

/** The speed along the orbit at an instant, in kilometres per second: the length of the interpolated velocity. */
export function interpolateSpeed(ephemeris: Ephemeris, at: Date): number {
  const { x, y, z } = interpolateVelocity(ephemeris, at.getTime());
  return Math.hypot(x, y, z);
}

/** The two vectors around an instant the Ephemeris must cover, the seconds between them and how far along the instant lies. */
function segmentAt(ephemeris: Ephemeris, t: number): { a: StateVector; b: StateVector; h: number; tau: number } {
  const { vectors } = ephemeris;
  if (t < vectors[0]!.at.getTime() || t > vectors[vectors.length - 1]!.at.getTime()) {
    throw new PropagationError(`the Ephemeris does not cover ${new Date(t).toISOString()}`);
  }
  // The last vector at or before t, by binary search.
  let low = 0;
  let high = vectors.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (vectors[middle]!.at.getTime() <= t) low = middle;
    else high = middle;
  }
  const a = vectors[low]!;
  const b = vectors[high]!;
  const h = (b.at.getTime() - a.at.getTime()) / 1000;
  return { a, b, h, tau: (t - a.at.getTime()) / 1000 / h };
}

/**
 * A J2000 position rotated into the Earth-fixed frame: precession and
 * nutation take it to the equator and equinox of date, then the Earth's
 * rotation, measured by apparent sidereal time, to the prime meridian.
 * Polar motion, a few metres on the ground, is left out.
 */
export function j2000ToEcf(position: EciVec3<number>, at: Date): EcfVec3<number> {
  const time = MakeTime(at);
  const ofDate = RotateVector(Rotation_EQJ_EQD(time), new Vector(position.x, position.y, position.z, time));
  const angle = toRadians(SiderealTime(time) * 15);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: ofDate.x * cos + ofDate.y * sin, y: ofDate.y * cos - ofDate.x * sin, z: ofDate.z };
}

/** The ground point beneath an Earth-fixed position and its altitude, on the WGS84 ellipsoid. */
export function toPosition(ecf: EcfVec3<number>): Position {
  // An Earth-fixed vector is an inertial one at zero sidereal angle.
  const geodetic = eciToGeodetic(ecf, 0);
  if (!Number.isFinite(geodetic.latitude + geodetic.longitude + geodetic.height)) {
    throw new PropagationError("interpolation produced a non-finite Position");
  }
  return { latitude: degreesLat(geodetic.latitude), longitude: degreesLong(geodetic.longitude), altitude: geodetic.height };
}
