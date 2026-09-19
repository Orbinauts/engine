import { constants } from "satellite.js";
import { orbitalPeriodSeconds, toSatRec, type Elements } from "./elements.js";
import { MU_KM3_PER_S2 } from "./orbit.js";

/**
 * What the Elements say of the orbit's shape and of where along it the
 * Satellite is: the two apsides, and the phase of the orbit at an
 * instant. Both are mean values read off the Elements, as the period is,
 * not osculating ones read off a propagated state: they describe the orbit
 * a reader is told about, and they move only when the Elements do.
 */

/** The heights of the two ends of the orbit above the Earth, in kilometres. */
export interface Apsides {
  /** The farthest the orbit takes the Satellite from the Earth's surface. */
  apogeeKm: number;
  /** The closest it comes. */
  perigeeKm: number;
}

/**
 * The apogee and perigee of the orbit, as heights above the Earth's
 * equatorial radius. SGP4 works both out when it initialises its record
 * from the Elements — the semi-major axis from the mean motion once the
 * Kozai term is taken out, then `a(1 ± e)` less one Earth radius — so
 * they are read off the record rather than worked out a second time from
 * Kepler's law, which would differ by the un-Kozai correction. The radius
 * is the one SGP4's own constants use (WGS72), the same the propagation
 * already runs on.
 */
export function apsides(elements: Elements): Apsides {
  const satrec = toSatRec(elements);
  return { apogeeKm: satrec.alta * constants.earthRadius, perigeeKm: satrec.altp * constants.earthRadius };
}

/**
 * The semi-major axis of an orbit flown at a mean motion, in kilometres, by
 * Kepler's third law, the mean motion in revolutions a day as the Elements
 * give it. Unlike the apsides, which SGP4 reads off a record it
 * initialises from a whole set, this needs the one number, so a change in
 * mean altitude between two sets can be told from their mean motions alone:
 * the un-Kozai correction it leaves out moves the axis by a few kilometres
 * at most, and a change in it by a part in a thousand.
 */
export function semiMajorAxisKm(meanMotion: number): number {
  const radiansPerSecond = (meanMotion * 2 * Math.PI) / 86_400;
  return Math.cbrt(MU_KM3_PER_S2 / radiansPerSecond ** 2);
}

/**
 * How long one turn of a circular orbit at an altitude takes, in seconds,
 * by Kepler's third law over the same equatorial radius the apsides are
 * heights above. It is what can be said of a Satellite a caller has no
 * Elements for, from nothing but a published altitude; the period of a
 * Satellite with Elements is `orbitalPeriodSeconds`, read off the mean
 * motion.
 */
export function circularPeriodSeconds(altitudeKm: number): number {
  const radiusKm = constants.earthRadius + altitudeKm;
  return 2 * Math.PI * Math.sqrt(radiusKm ** 3 / MU_KM3_PER_S2);
}

/** Where along its orbit the Satellite is at an instant, by mean anomaly. */
export interface OrbitPhase {
  /** How much of the orbit is behind it since the last perigee, in [0, 1). */
  fraction: number;
  /** How long until it is back at perigee, in seconds: the rest of the orbit at the mean motion. */
  completesInSeconds: number;
  /** One orbit at the mean motion, in seconds (`orbitalPeriodSeconds`). */
  periodSeconds: number;
  /** When the orbit began: the last perigee, `fraction` of a period ago. */
  began: Date;
  /** When it ends: the next perigee, `completesInSeconds` from the instant, where the next orbit begins. */
  ends: Date;
}

/**
 * The phase of the orbit at an instant: the mean anomaly the Elements give
 * at their epoch, carried forward at the mean motion, as a fraction of a
 * turn. Counted from perigee, which is where mean anomaly is zero; for the
 * near-circular orbits most Satellites fly the perigee is an arbitrary
 * point, and the phase only has to advance at the right rate and wrap once
 * an orbit. The secular drift SGP4 adds to the mean anomaly is left out on
 * purpose: over one ninety-minute orbit it is far too small to matter,
 * and leaving it out keeps the answer the Elements' own two numbers.
 *
 * The orbit it is a phase of runs from one perigee to the next, so its two
 * ends are instants of the same reckoning: whoever names the places under
 * them and whoever draws the orbit as a strip between them read the same two
 * instants, whichever of them computes them.
 */
export function orbitPhase(elements: Elements, at: Date): OrbitPhase {
  const periodSeconds = orbitalPeriodSeconds(elements);
  const elapsed = (at.getTime() - elements.epoch.getTime()) / 1000;
  const turns = elements.omm.MEAN_ANOMALY / 360 + elapsed / periodSeconds;
  const fraction = ((turns % 1) + 1) % 1;
  const completesInSeconds = (1 - fraction) * periodSeconds;
  return {
    fraction,
    completesInSeconds,
    periodSeconds,
    began: new Date(at.getTime() - fraction * periodSeconds * 1000),
    ends: new Date(at.getTime() + completesInSeconds * 1000),
  };
}
