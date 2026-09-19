import { predictedMagnitude } from "./brightness.js";
import { VISIBLE_FAINTEST_MAGNITUDE } from "./passes.js";

/**
 * The Naked-eye rule: whether a Satellite can ever be seen with the naked
 * eye at all, from anywhere on Earth, decided by the brightness model from
 * two numbers the field publishes for it (its Standard magnitude and its
 * typical altitude) rather than declared by a hand-kept flag, so that
 * nothing hand-entered can contradict the Pass search: if the rule says a
 * Satellite is Naked-eye, the search can in fact open a Visible window for
 * it. A caller that lists only the Satellites worth looking up at asks here,
 * so the rule is one function and one pair of numbers per Satellite.
 */

/** The typical altitude a Satellite keeps, in kilometres: the range its definition states, whose low end is the closest it comes. */
export interface AltitudeRangeKm {
  from: number;
  to: number;
}

/**
 * The brightest a Satellite of this Standard magnitude can ever look, as an
 * apparent magnitude: the model at the best geometry the Satellite's own orbit
 * allows an Observer — the low end of its typical altitude, straight
 * overhead, so the range is the altitude, and half its lit side turned this
 * way, the phase a Standard magnitude is stated at. Nothing about where the
 * Observer stands can beat it.
 */
export function brightestPossibleMagnitude(standardMagnitude: number, altitudeKm: AltitudeRangeKm): number {
  return predictedMagnitude(standardMagnitude, altitudeKm.from, Math.PI / 2);
}

/**
 * Whether the Satellite is a Naked-eye Satellite: whether the
 * brightest it can ever look reaches the Visible window's faintest
 * magnitude, the same number the Pass search judges brightness by, so a
 * Satellite the rule accepts is one the search can in fact open a window for.
 *
 * A Satellite the field has published no Standard magnitude for has no
 * brightness to reach it with and is therefore not Naked-eye: the number is
 * never estimated. A stand-in lands where the guess puts it, and near the
 * line that is a coin toss: Landsat 9 at a stand-in of 4.7 would be 3.9
 * overhead, just bright enough.
 *
 * @param options.faintestMagnitude The faintest apparent magnitude that
 * counts as seen, `VISIBLE_FAINTEST_MAGNITUDE` unless the caller sets
 * another, as they would the Pass search's for the same sky.
 */
export function isNakedEye(
  standardMagnitude: number | undefined,
  altitudeKm: AltitudeRangeKm,
  options: { faintestMagnitude?: number } = {},
): boolean {
  const { faintestMagnitude = VISIBLE_FAINTEST_MAGNITUDE } = options;
  return standardMagnitude !== undefined && brightestPossibleMagnitude(standardMagnitude, altitudeKm) <= faintestMagnitude;
}
