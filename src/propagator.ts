import { eciToGeodetic, gstime, type EciVec3 } from "satellite.js";
import { courseOf, groundVelocity, type GroundVelocity } from "./course.js";
import { toSatRec, type Elements } from "./elements.js";
import { isGeostationary } from "./geostationary.js";
import { positionOf, propagateState, type Position } from "./position.js";
import { isSunlitBy, sunPosition } from "./sun.js";

/** What a Body is doing at an instant: everything a live map draws and says about it, from one propagation. */
export interface BodyState {
  position: Position;
  /** Its speed along its orbit, in kilometres per second. */
  speed: number;
  /**
   * How fast the point beneath it moves over the ground, north and east, in
   * kilometres per second at the ellipsoid's surface: the motion a map can
   * carry a marker along between the instants it propagates.
   */
  groundVelocity: GroundVelocity;
  /**
   * The Course: the way its sub-point moves over the ground, in degrees
   * clockwise from north. None for a Geostationary Body, whose sub-point
   * stands still over one point of the equator.
   */
  course?: number;
  /** Whether it is in the Sun's light rather than the Earth's shadow. */
  sunlit: boolean;
}

/**
 * A Body's propagation built once from its Elements: the SGP4 record and
 * whether the orbit is Geostationary, worked out when it is built and never
 * again, so each instant asked costs one propagation and the arithmetic
 * round it. A caller that animates a marker builds one per Body per set of
 * Elements and asks it every second.
 */
export interface Propagator {
  /** The Elements it was built from. */
  readonly elements: Elements;
  /**
   * The Body's state at the instant: the Position, speed, Course and Sunlit
   * state `propagate`, `orbitalSpeed`, `course` and `isSunlit` answer for its
   * Elements, to the bit, from one propagation instead of four. Throws a
   * PropagationError where SGP4 fails at the instant, as `propagate` does.
   */
  stateAt(at: Date): BodyState;
}

/** The Propagator for the Elements. */
export function propagator(elements: Elements): Propagator {
  const satrec = toSatRec(elements);
  const standing = isGeostationary(elements);
  return {
    elements,
    stateAt(at) {
      const { position, velocity } = propagateState(satrec, at);
      const gmst = gstime(at);
      const geodetic = eciToGeodetic(position, gmst);
      const overGround = groundVelocity(position, velocity, gmst, geodetic);
      return {
        position: positionOf(geodetic),
        speed: Math.hypot(velocity.x, velocity.y, velocity.z),
        groundVelocity: overGround,
        course: standing ? undefined : courseOf(overGround),
        sunlit: isSunlitBy(position, sunAt(at)),
      };
    },
  };
}

/**
 * The Sun's centre in SGP4's frame at the last instant asked. A map asks
 * every Body's state at one instant in turn, and the Sun's place is the one
 * part of a state that is the same for all of them and costs more than a
 * propagation to work out, so it is worked out once per instant.
 */
let sun: { at: number; position: EciVec3<number> } | undefined;

function sunAt(at: Date): EciVec3<number> {
  if (sun?.at !== at.getTime()) sun = { at: at.getTime(), position: sunPosition(at, "teme") };
  return sun.position;
}
