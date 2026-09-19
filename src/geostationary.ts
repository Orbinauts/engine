import type { Elements } from "./elements.js";
import { SIDEREAL_DAY_SECONDS } from "./time.js";

/**
 * Geostationary: an orbit that keeps a Satellite over one longitude of the
 * equator, so that from any Observer it is always in view or never, and it
 * has no Passes. A property of the orbit, read from the Elements rather than
 * declared by a category or a flag — a weather satellite
 * may be Geostationary or not, and the Elements are what say which.
 *
 * The rule is three bounds on three published numbers: the Satellite goes
 * round once a sidereal day, on a circle, over the equator. Miss any one of
 * them and the Satellite moves across the sky: too fast or too slow and it
 * drifts along the equator, eccentric and it runs ahead of the Earth and
 * falls back, inclined and it traces a figure of eight. Skyfield's own
 * propagation of each fixture set bears the classification out
 * (`oracle/geostationary.py`).
 */

/**
 * Revolutions a day of an orbit whose period is one sidereal day, 86,164.09
 * seconds: the rate at which a Satellite keeps pace with the turning Earth.
 */
export const GEOSTATIONARY_MEAN_MOTION = 86_400 / SIDEREAL_DAY_SECONDS;

/**
 * How far from that rate the mean motion may be, in revolutions a day: a
 * day's drift along the equator is 360 degrees times the difference, so
 * this is one degree of longitude a day. A Satellite inside the band stands
 * over its longitude for the ten days a Pass search may cover; one outside
 * it is on its way somewhere else.
 */
export const GEOSTATIONARY_MEAN_MOTION_BAND = 1 / 360;

/**
 * How eccentric the orbit may be. An eccentric geosynchronous Satellite runs
 * ahead of the turning Earth near perigee and falls behind near apogee, so
 * it swings east and west of its longitude by roughly 2e radians; at this
 * bound that swing is a degree either way.
 */
export const GEOSTATIONARY_MAX_ECCENTRICITY = 0.01;

/**
 * How far the orbit may be inclined, in degrees. An inclined Satellite's
 * sub-point swings this far north and south of the equator each day, the
 * figure of eight an inclined geosynchronous Satellite is known by.
 *
 * The bound is a few degrees rather than a fraction of one because an
 * operator that stops correcting north and south lets the inclination grow
 * by about 0.85 degrees a year, and the rule has to go on catching such a
 * Satellite: for every Observer who keeps it in sight the search cannot end,
 * and they are the great majority. What that costs is measured rather than
 * assumed (`oracle/geostationary.py`): a Satellite exactly at this bound does
 * rise and set for the ring of Observers at the edge of its Footprint — 56
 * of a 612-point grid over the Earth — but it climbs no more than 8.2
 * degrees above their horizon, under the 10 a Visible window needs, so the
 * Passes refused along with theirs are grazings of a Satellite no eye could
 * see. Beyond this bound lies the wider geosynchronous class — the
 * navigation and Tundra orbits inclined by tens of degrees — which crosses
 * the sky and has Passes worth finding.
 */
export const GEOSTATIONARY_MAX_INCLINATION_DEGREES = 5;

/** Whether these Elements describe a Geostationary orbit: all three bounds met, each inclusive. */
export function isGeostationary(elements: Elements): boolean {
  const { MEAN_MOTION, ECCENTRICITY, INCLINATION } = elements.omm;
  return (
    Math.abs(MEAN_MOTION - GEOSTATIONARY_MEAN_MOTION) <= GEOSTATIONARY_MEAN_MOTION_BAND &&
    ECCENTRICITY <= GEOSTATIONARY_MAX_ECCENTRICITY &&
    Math.abs(INCLINATION) <= GEOSTATIONARY_MAX_INCLINATION_DEGREES
  );
}
