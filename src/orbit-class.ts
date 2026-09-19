import type { Elements } from "./elements.js";
import { GEOSTATIONARY_MAX_INCLINATION_DEGREES, GEOSTATIONARY_MEAN_MOTION, isGeostationary } from "./geostationary.js";
import type { OrbitName } from "./orbit-names.js";
import { apsides } from "./orbit-shape.js";

/**
 * Orbit class: which of five orbits a Satellite flies, read from its
 * Elements as Geostationary is rather than declared in a list by hand, so
 * that every Satellite has one and it follows the orbit its latest Elements
 * describe. The rule asks four questions of three published
 * numbers and the apogee SGP4 reads off them, in this order, and the first
 * that answers yes names the class:
 *
 * 1. Geostationary, by the Geostationary rule itself (`geostationary.ts`),
 *    so the class and the refusal of Passes can never disagree.
 * 2. Inclined geosynchronous: round once a sidereal day, within a window
 *    far wider than the Geostationary rule's band, and inclined past its
 *    bound, so it traces a figure of eight across the sky (BeiDou's IGSO).
 * 3. Highly elliptical: an eccentricity above a quarter, whatever the height
 *    (Chandra, from 12,000 to 137,000 km).
 * 4. Low Earth orbit when the whole orbit, apogee included, is below
 *    2,000 km; otherwise medium Earth orbit, everything between the low
 *    orbits and the geosynchronous ones (GPS, Galileo, and Vanguard 1, which
 *    dips to 655 km but climbs to 3,800).
 *
 * The order settles the orbits two questions could claim: a day-long orbit
 * inclined and eccentric past a quarter (a Tundra orbit) is named by its
 * period, which is what holds it over one region of the Earth; and a
 * near-circular geosynchronous one inclined under the Geostationary bound
 * but outside its band, drifting along the equator, falls through to medium
 * Earth orbit, the rule having no sixth class for a Satellite on its way
 * somewhere else.
 */

/**
 * How far from a sidereal day's rate the mean motion of a geosynchronous
 * orbit may be, in revolutions a day: a tenth of it either side, a period
 * from about 21.8 to 26.6 hours. Wide enough for any orbit that keeps
 * roughly in step with the turning Earth, however far its figure of eight
 * has drifted in longitude, and far from the nearest other family, the
 * navigation orbits Galileo and GPS fly at 1.7 and 2 revolutions a day.
 */
export const GEOSYNCHRONOUS_MEAN_MOTION_WINDOW = GEOSTATIONARY_MEAN_MOTION / 10;

/** The eccentricity above which an orbit is highly elliptical: its apogee more than two thirds farther from the Earth's centre than its perigee. */
export const HIGHLY_ELLIPTICAL_MIN_ECCENTRICITY = 0.25;

/** The top of low Earth orbit, in kilometres: the ceiling the field draws, below which the whole orbit of a low one lies. */
export const LOW_EARTH_ORBIT_KM = 2_000;

/** The Orbit class of these Elements, by its abbreviation; a reader is told it in their own language's words. */
export function orbitClass(elements: Elements): OrbitName {
  if (isGeostationary(elements)) return "GEO";
  const { MEAN_MOTION, ECCENTRICITY, INCLINATION } = elements.omm;
  const geosynchronous = Math.abs(MEAN_MOTION - GEOSTATIONARY_MEAN_MOTION) <= GEOSYNCHRONOUS_MEAN_MOTION_WINDOW;
  if (geosynchronous && Math.abs(INCLINATION) > GEOSTATIONARY_MAX_INCLINATION_DEGREES) return "IGSO";
  if (ECCENTRICITY > HIGHLY_ELLIPTICAL_MIN_ECCENTRICITY) return "HEO";
  return apsides(elements).apogeeKm < LOW_EARTH_ORBIT_KM ? "LEO" : "MEO";
}
