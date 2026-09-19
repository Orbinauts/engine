import { describe, expect, test } from "vitest";
import { brightestPossibleMagnitude, isNakedEye } from "./naked-eye.js";
import { VISIBLE_FAINTEST_MAGNITUDE } from "./index.js";

/**
 * The Naked-eye rule at the boundary, in the numbers the rule was drawn up
 * with: the two Satellites it accepts, and the three ways of failing it.
 */
describe("the Naked-eye rule", () => {
  test("the brightest a Satellite can look is what the model says at the low end of its altitude, overhead and half lit", () => {
    // Hubble: 2.2 at 465 km, about 0.6.
    expect(brightestPossibleMagnitude(2.2, { from: 465, to: 480 })).toBeCloseTo(0.54, 2);
    // Terra: 2.7 at 705 km, about 1.9. The low end of the orbit its
    // September 2026 Elements describe, 688 km, gives the same 1.9: the
    // margin over the window's 4.0 is wide, and neither altitude is near the
    // edge.
    expect(brightestPossibleMagnitude(2.7, { from: 705, to: 705 })).toBeCloseTo(1.94, 2);
    expect(brightestPossibleMagnitude(2.7, { from: 688, to: 691 })).toBeCloseTo(1.89, 2);
    // Chandra: 3.2 at its 12,000 km perigee, about 8.6.
    expect(brightestPossibleMagnitude(3.2, { from: 12_000, to: 133_000 })).toBeCloseTo(8.6, 1);
  });

  test("a Satellite whose brightest reaches the Visible window's faintest magnitude is Naked-eye", () => {
    expect(isNakedEye(-1.8, { from: 400, to: 420 })).toBe(true); // The ISS.
    expect(isNakedEye(2.2, { from: 465, to: 480 })).toBe(true); // Hubble.
    expect(isNakedEye(2.7, { from: 705, to: 705 })).toBe(true); // Terra.
    expect(isNakedEye(2.7, { from: 688, to: 691 })).toBe(true); // Terra, at the altitude its Elements give.
  });

  test("a Satellite too faint at the top of its own sky is not", () => {
    expect(isNakedEye(3.2, { from: 12_000, to: 133_000 })).toBe(false); // Chandra.
    expect(isNakedEye(4, { from: 20_000, to: 20_200 })).toBe(false); // A navigation Satellite's altitude.
    expect(isNakedEye(10.2, { from: 650, to: 3_800 })).toBe(false); // Vanguard 1.
  });

  test("a Satellite the field has published no Standard magnitude for is not, whatever its altitude", () => {
    expect(isNakedEye(undefined, { from: 400, to: 420 })).toBe(false);
    expect(isNakedEye(undefined, { from: 35_786, to: 35_786 })).toBe(false);
  });

  test("the boundary is the Visible window's faintest magnitude, from the same constant, and it is inclusive", () => {
    const overhead = { from: 1_000, to: 1_000 };

    expect(brightestPossibleMagnitude(VISIBLE_FAINTEST_MAGNITUDE, overhead)).toBe(VISIBLE_FAINTEST_MAGNITUDE);
    expect(isNakedEye(VISIBLE_FAINTEST_MAGNITUDE, overhead)).toBe(true);
    expect(isNakedEye(VISIBLE_FAINTEST_MAGNITUDE + 0.1, overhead)).toBe(false);
  });

  test("the faintest magnitude is the caller's, the Visible window's when none is given", () => {
    const overhead = { from: 1_000, to: 1_000 };

    expect(isNakedEye(VISIBLE_FAINTEST_MAGNITUDE + 0.1, overhead, { faintestMagnitude: VISIBLE_FAINTEST_MAGNITUDE })).toBe(false);
    expect(isNakedEye(VISIBLE_FAINTEST_MAGNITUDE + 0.1, overhead, { faintestMagnitude: 6 })).toBe(true);
    expect(isNakedEye(2.2, { from: 465, to: 480 }, { faintestMagnitude: 0 })).toBe(false); // Hubble, against a limit only the brightest stars reach.
    expect(isNakedEye(undefined, overhead, { faintestMagnitude: 30 })).toBe(false);
  });
});
