import type { EcfVec3 } from "satellite.js";

/**
 * How bright a Satellite looks: the field's diffuse-sphere model, the one the
 * published Standard magnitudes are stated for.
 *
 * A magnitude is a brightness on the astronomers' scale, where smaller is
 * brighter and five magnitudes are a hundredfold: Venus at its best is about
 * -4, the faintest star a city sky shows is about 4.
 */

/** The range a Standard magnitude is stated at, in kilometres (Molczan's convention: 1,000 km, half lit). */
export const STANDARD_MAGNITUDE_RANGE_KM = 1000;

/**
 * The illuminated fraction is floored here, as Stellarium floors it, so that
 * a Satellite lit from exactly behind is very faint rather than infinitely
 * faint and every predicted magnitude is a finite number.
 */
const MIN_ILLUMINATED_FRACTION = 1e-6;

/**
 * The brightness a Satellite of this Standard magnitude shows at this range
 * and phase angle, as an apparent magnitude:
 *
 *     m = standard + 5 log10(range / 1,000 km) - 2.5 log10(2f),
 *     f = (1 + cos phase) / 2, the fraction of the Satellite's disc that is lit
 *
 * so that it returns the Standard magnitude at the geometry that one is
 * stated for. It models the Satellite as a diffusely reflecting sphere and
 * ignores what such a model cannot know: glints off flat surfaces, specular
 * flares, and the dimming of the atmosphere near the horizon. Treat it as an
 * estimate, never a promise.
 *
 * @param phase The phase angle at the Satellite between the Sun and the Observer, in radians.
 */
export function predictedMagnitude(standardMagnitude: number, rangeKm: number, phase: number): number {
  const illuminated = Math.max((1 + Math.cos(phase)) / 2, MIN_ILLUMINATED_FRACTION);
  return standardMagnitude + 5 * Math.log10(rangeKm / STANDARD_MAGNITUDE_RANGE_KM) - 2.5 * Math.log10(2 * illuminated);
}

/**
 * The phase angle at the Satellite between the Sun and the Observer, in
 * radians: 0 when the Sun is behind the Observer and the Satellite shows a full
 * disc, a right angle when it is half lit, pi when the Satellite is between the
 * two and shows its dark side. The three positions must be in one frame.
 */
export function phaseAngle(satellite: EcfVec3<number>, observer: EcfVec3<number>, sun: EcfVec3<number>): number {
  const toSun = { x: sun.x - satellite.x, y: sun.y - satellite.y, z: sun.z - satellite.z };
  const toObserver = { x: observer.x - satellite.x, y: observer.y - satellite.y, z: observer.z - satellite.z };
  const dot = toSun.x * toObserver.x + toSun.y * toObserver.y + toSun.z * toObserver.z;
  const lengths = Math.hypot(toSun.x, toSun.y, toSun.z) * Math.hypot(toObserver.x, toObserver.y, toObserver.z);
  return Math.acos(Math.min(1, Math.max(-1, dot / lengths)));
}
