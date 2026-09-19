import { Body, Equator, Horizon, Observer as SkyObserver, SiderealTime } from "astronomy-engine";
import { eciToEcf, gstime, type EcfVec3, type EciVec3 } from "satellite.js";
import { wrapLongitude } from "./angles.js";
import type { GroundPoint, Observer } from "./position.js";

const EARTH_CENTRE = new SkyObserver(0, 0, 0);

/**
 * The subsolar point: where the Sun is overhead at an instant. Its latitude
 * is the Sun's declination and its longitude follows the Sun's hour angle
 * from Greenwich; the day/night terminator is the great circle 90 degrees
 * from it.
 */
export function subsolarPoint(at: Date): GroundPoint {
  const sun = Equator(Body.Sun, at, EARTH_CENTRE, true, true);
  const greenwichSiderealHours = SiderealTime(at);
  return {
    latitude: sun.dec,
    longitude: wrapLongitude((sun.ra - greenwichSiderealHours) * 15),
  };
}

/** The Sun's altitude above the Observer's horizon at an instant, in degrees, without refraction. */
export function sunAltitude(observer: Observer, at: Date): number {
  const site = new SkyObserver(observer.latitude, observer.longitude, observer.altitude);
  const sun = Equator(Body.Sun, at, site, true, true);
  return Horizon(at, site, sun.ra, sun.dec).altitude;
}

/** The equatorial frame an inertial position is expressed in: SGP4's TEME or the Ephemeris's J2000. */
export type InertialFrame = "teme" | "j2000";

/** The Earth's equatorial radius, the sphere that casts the shadow (as in Skyfield), in kilometres. */
const SHADOW_RADIUS_KM = 6378.1366;
const KM_PER_AU = 149_597_870.7;

/**
 * The Sun's position at an instant in the Earth-fixed frame, in kilometres:
 * the apparent geocentric position the shadow test uses, turned by the same
 * Greenwich sidereal angle that turns a Satellite's inertial position into its
 * Earth-fixed one, so that an angle between the two is measured in one
 * frame.
 */
export function sunEcf(at: Date): EcfVec3<number> {
  const sun = Equator(Body.Sun, at, EARTH_CENTRE, true, false).vec;
  return eciToEcf({ x: sun.x * KM_PER_AU, y: sun.y * KM_PER_AU, z: sun.z * KM_PER_AU }, gstime(at));
}

/**
 * Whether an inertial position is sunlit: it is in shadow when the line from
 * it towards the Sun's centre passes through the Earth ahead of it. A point
 * Sun and a spherical Earth, so the penumbra counts as sunlit. The Sun is
 * taken in the position's frame: the equator of date for TEME, which differs
 * from it only by the equation of the equinoxes, or J2000.
 */
export function isSunlitAt(position: EciVec3<number>, at: Date, frame: InertialFrame): boolean {
  return isSunlitBy(position, sunPosition(at, frame));
}

/**
 * The Sun's centre at an instant in an inertial frame, in kilometres from
 * the Earth's: the equator of date for TEME, J2000 for J2000. Worked out
 * apart from the shadow test so that a caller testing many positions over
 * a span the Sun barely moves in, as a Ground track does, can take it once.
 */
export function sunPosition(at: Date, frame: InertialFrame): EciVec3<number> {
  const sun = Equator(Body.Sun, at, EARTH_CENTRE, frame === "teme", false).vec;
  return { x: sun.x * KM_PER_AU, y: sun.y * KM_PER_AU, z: sun.z * KM_PER_AU };
}

/** The shadow test of `isSunlitAt`, against the Sun's centre given in the position's own frame. */
export function isSunlitBy(position: EciVec3<number>, sun: EciVec3<number>): boolean {
  const toSun = { x: sun.x - position.x, y: sun.y - position.y, z: sun.z - position.z };
  const distance = Math.hypot(toSun.x, toSun.y, toSun.z);
  // How far along the line to the Sun the point nearest the Earth's centre lies.
  const along = -(position.x * toSun.x + position.y * toSun.y + position.z * toSun.z) / distance;
  if (along <= 0) return true;
  const nearestSquared = position.x ** 2 + position.y ** 2 + position.z ** 2 - along ** 2;
  return nearestSquared >= SHADOW_RADIUS_KM ** 2;
}
