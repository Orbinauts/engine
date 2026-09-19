import { constants, eciToEcf, gstime, type EcfVec3, type EciVec3, type SatRec } from "satellite.js";
import { toSatRec } from "./elements.js";
import { interpolateState, j2000ToEcf, type Ephemeris } from "./ephemeris.js";
import { propagateState } from "./position.js";
import { isEphemeris, type Source } from "./source.js";
import { EARTH_MEAN_RADIUS_KM } from "./sphere.js";
import { isSunlitAt, type InertialFrame } from "./sun.js";

/** A Satellite's path through time in the frames the searches need, whichever source it comes from. */
export interface Orbit {
  /** The inertial frame the source gives positions in: SGP4's TEME for Elements, J2000 for an Ephemeris. */
  readonly frame: InertialFrame;
  /** The position at the instant in that frame, in kilometres. */
  inertialAt(t: number): EciVec3<number>;
  /** The Earth-fixed position at the instant, in kilometres. */
  ecfAt(t: number): EcfVec3<number>;
  /** Whether the Satellite is in sunlight at the instant. */
  sunlitAt(t: number): boolean;
  /**
   * An upper bound on the Satellite's speed relative to a point on the rotating
   * Earth, in km/s. Only the Pass search reads it, and reading it is what
   * scans the source for the orbit's shape: a caller after one instant, as
   * isSunlit is, pays nothing for it.
   */
  readonly relativeSpeedBound: number;
  /**
   * A lower bound on how far the Satellite can ever be from a point on the
   * Earth's surface, in kilometres: its closest approach to the centre less
   * the widest the Earth is. Nothing about where an Observer stands or when
   * they look can beat it, so the brightest the Satellite can ever appear
   * follows from it, which is what lets the Pass search rule out a Visible
   * window before looking for one. Zero for an orbit whose perigee is inside
   * the Earth, which bounds nothing and makes the search look anyway.
   */
  readonly minRangeBound: number;
}

/** The Orbit of either source: propagated from Elements, interpolated from an Ephemeris. */
export function orbitOf(source: Source): Orbit {
  return isEphemeris(source) ? ephemerisOrbit(source) : elementsOrbit(toSatRec(source));
}

/** Whether the Satellite is in sunlight, rather than in the Earth's shadow, at an instant, from either source. */
export function isSunlit(source: Source, at: Date): boolean {
  return orbitOf(source).sunlitAt(at.getTime());
}

/** How often the light is sampled when the next change is searched for, in seconds: no eclipse is shorter than this, the penumbra counting as Sunlit. */
const LIGHT_STEP_SECONDS = 60;
/** How closely the change is then pinned, in seconds. */
const LIGHT_PRECISION_SECONDS = 1;

/**
 * The next instant the Satellite goes into the Earth's shadow or comes
 * out of it after `at`, within the seconds given, or nothing where the
 * light does not change in that time — a Geostationary Satellite is in
 * sunlight for weeks outside its eclipse seasons. Sampled a minute
 * at a time and then pinned by bisection to the second, so a caller
 * asking every second still pays one sample per orbit rather than one per
 * second: it asks again only once the instant answered has gone by.
 */
export function nextLightChange(source: Source, at: Date, withinSeconds: number): Date | undefined {
  const orbit = orbitOf(source);
  const from = at.getTime();
  const sunlit = orbit.sunlitAt(from);
  const step = LIGHT_STEP_SECONDS * 1000;
  let before = from;
  for (let after = from + step; after <= from + withinSeconds * 1000; after += step) {
    if (orbit.sunlitAt(after) === sunlit) {
      before = after;
      continue;
    }
    while (after - before > LIGHT_PRECISION_SECONDS * 1000) {
      const middle = (before + after) / 2;
      if (orbit.sunlitAt(middle) === sunlit) before = middle;
      else after = middle;
    }
    return new Date(after);
  }
  return undefined;
}

/** The Earth's gravitational parameter, in cubic kilometres per second squared. */
export const MU_KM3_PER_S2 = 398600.4418;
/** The Earth's turning against the stars, in radians per second. */
export const EARTH_ROTATION_RAD_PER_S = 7.2921159e-5;
/**
 * The widest the Earth is, in kilometres: the WGS84 ellipsoid's equatorial
 * radius, so that a bound taken against it holds wherever an Observer
 * stands, and the one satellite.js reads a geodetic sub-point against.
 */
export const EARTH_EQUATORIAL_RADIUS_KM = 6378.137;
/** Bounds carry this margin. */
const SPEED_MARGIN = 1.05;
/** The Pass length bound carries a larger one: the Observer's altitude and the ellipsoid both widen the horizon. */
const PASS_LENGTH_MARGIN = 1.2;

function elementsOrbit(satrec: SatRec): Orbit {
  let bound: number | undefined;
  let closest: number | undefined;
  let scanned: OrbitShape | undefined;
  const shape = () => (scanned ??= elementsShape(satrec));
  const inertialAt = (t: number) => propagateState(satrec, new Date(t)).position;
  return {
    frame: "teme",
    inertialAt,
    ecfAt: (t) => eciToEcf(inertialAt(t), gstime(new Date(t))),
    sunlitAt: (t) => isSunlitAt(inertialAt(t), new Date(t), "teme"),
    get relativeSpeedBound() {
      return (bound ??= speedBound(shape()));
    },
    get minRangeBound() {
      return (closest ??= rangeBound(shape()));
    },
  };
}

function ephemerisOrbit(ephemeris: Ephemeris): Orbit {
  let bound: number | undefined;
  let closest: number | undefined;
  let scanned: OrbitShape | undefined;
  const shape = () => (scanned ??= ephemerisShape(ephemeris));
  const inertialAt = (t: number) => interpolateState(ephemeris, t);
  return {
    frame: "j2000",
    inertialAt,
    ecfAt: (t) => j2000ToEcf(inertialAt(t), new Date(t)),
    sunlitAt: (t) => isSunlitAt(inertialAt(t), new Date(t), "j2000"),
    get relativeSpeedBound() {
      return (bound ??= speedBound(shape()));
    },
    get minRangeBound() {
      return (closest ??= rangeBound(shape()));
    },
  };
}

/** The bound from the shape: the fastest the Satellite goes, plus the fastest the Earth turns under it, with the margin. */
function speedBound({ maxSpeed, maxRadius }: OrbitShape): number {
  return SPEED_MARGIN * (maxSpeed + EARTH_ROTATION_RAD_PER_S * maxRadius);
}

/** The range bound from the shape: the closest the Satellite comes to the centre, less the widest the Earth is, and never negative. */
function rangeBound({ minRadius }: OrbitShape): number {
  return Math.max(0, minRadius - EARTH_EQUATORIAL_RADIUS_KM);
}

/**
 * An upper bound on how long any Pass of the Satellite over any Observer lasts,
 * in seconds: the time to cross the diameter of the Footprint at the highest
 * point of the orbit, at the slowest the point beneath the Satellite can move
 * over the rotating Earth. The Ephemeris must cover a Pass search's interval
 * extended by this much at both ends, since a Pass in progress at either end
 * is reported in full.
 */
export function longestPassSeconds(source: Source): number {
  const { maxRadius, minAngularSpeed } = isEphemeris(source) ? ephemerisShape(source) : elementsShape(toSatRec(source));
  const footprintHalfAngle = Math.acos(EARTH_MEAN_RADIUS_KM / maxRadius);
  // The point beneath the Satellite turns about the Earth's centre at least
  // this fast in the rotating frame: the Satellite's angular velocity about
  // the centre, of this magnitude along the orbit's normal, less the
  // Earth's along its axis. Two vectors of these magnitudes are never
  // closer together than the difference of the magnitudes, whatever the
  // inclination between them, and a Satellite slower than the Earth turns is
  // carried westward at the difference just the same.
  const groundRate = Math.abs(minAngularSpeed - EARTH_ROTATION_RAD_PER_S);
  return (PASS_LENGTH_MARGIN * 2 * footprintHalfAngle) / groundRate;
}

/** The extremes of an orbit the bounds need: radius and speed in km and km/s, angular speed in rad/s. */
interface OrbitShape {
  maxRadius: number;
  minRadius: number;
  maxSpeed: number;
  minAngularSpeed: number;
}

/** From the Elements: the speed at perigee, the radius and the angular speed at apogee. */
function elementsShape(satrec: SatRec): OrbitShape {
  const semiMajorAxis = satrec.a * constants.earthRadius;
  const perigee = semiMajorAxis * (1 - satrec.ecco);
  const apogee = semiMajorAxis * (1 + satrec.ecco);
  const apogeeSpeed = Math.sqrt(MU_KM3_PER_S2 * (2 / apogee - 1 / semiMajorAxis));
  return {
    maxRadius: apogee,
    minRadius: perigee,
    maxSpeed: Math.sqrt(MU_KM3_PER_S2 * (2 / perigee - 1 / semiMajorAxis)),
    minAngularSpeed: apogeeSpeed / apogee,
  };
}

/** From the vectors: the farthest, the fastest and the slowest-turning of them. */
function ephemerisShape(ephemeris: Ephemeris): OrbitShape {
  const shape: OrbitShape = { maxRadius: 0, minRadius: Infinity, maxSpeed: 0, minAngularSpeed: Infinity };
  for (const { position: r, velocity: v } of ephemeris.vectors) {
    const radius = Math.hypot(r.x, r.y, r.z);
    const angularMomentum = Math.hypot(r.y * v.z - r.z * v.y, r.z * v.x - r.x * v.z, r.x * v.y - r.y * v.x);
    shape.maxRadius = Math.max(shape.maxRadius, radius);
    shape.minRadius = Math.min(shape.minRadius, radius);
    shape.maxSpeed = Math.max(shape.maxSpeed, Math.hypot(v.x, v.y, v.z));
    shape.minAngularSpeed = Math.min(shape.minAngularSpeed, angularMomentum / (radius * radius));
  }
  return shape;
}
