import { describe, expect, test } from "vitest";
import { isSunlit, parseEphemeris, subsolarPoint, sunAltitude } from "./index.js";
import { ephemerisOracle, fixtureElements, fixtureEphemerisText, oracle, passOracle } from "../test/oracle.js";

describe("subsolarPoint", () => {
  test.each(oracle.subsolar)("at $at agrees with Skyfield within the tolerance", (expected) => {
    const point = subsolarPoint(new Date(expected.at));

    expect(Math.abs(point.latitude - expected.latitude)).toBeLessThan(oracle.tolerance.subsolarDegrees);
    expect(Math.abs(point.longitude - expected.longitude)).toBeLessThan(oracle.tolerance.subsolarDegrees);
  });
});

/** Every culmination in the Pass fixtures, with the Observer and Elements it belongs to. */
const culminations = passOracle.searches.flatMap((search) =>
  search.passes.map((pass) => ({ search: search.key, elements: search.elements, observer: search.observer, ...pass.culmination })),
);

/** How far from a shadow crossing an instant must be for the two frames to have to agree. */
const TERMINATOR_MARGIN_SECONDS = 120;
/** How often the window before the reboost is sampled. */
const STEP_SECONDS = 30;

describe("isSunlit", () => {
  test.each(culminations)("of $elements at $at agrees with Skyfield", (culmination) => {
    expect(isSunlit(fixtureElements(culmination.elements), new Date(culmination.at))).toBe(culmination.sunlit);
  });

  /**
   * The Ephemeris path answers in J2000 where the Elements path answers in
   * TEME, so the two frames are checked against each other over the window
   * before the fixture's reboost, where the Ephemeris follows the same orbit
   * as the Elements the Skyfield fixtures above check. Instants within
   * TERMINATOR_MARGIN_SECONDS of a shadow entry or exit are skipped: there
   * the kilometre the two paths differ by moves the answer, and the crossing
   * itself is what a Pass fixture already pins.
   */
  test("from the Ephemeris agrees with the Elements away from the terminator", () => {
    const ephemeris = parseEphemeris(fixtureEphemerisText());
    const elements = fixtureElements(ephemerisOracle.elements);
    const from = new Date(ephemerisOracle.covers.from).getTime();
    const to = new Date(ephemerisOracle.reboost.at).getTime();
    const states = new Set<boolean>();
    let compared = 0;
    let skipped = 0;

    for (let t = from; t <= to; t += STEP_SECONDS * 1000) {
      const at = new Date(t);
      const state = isSunlit(elements, at);
      const nearTerminator = [-TERMINATOR_MARGIN_SECONDS, TERMINATOR_MARGIN_SECONDS].some(
        (offset) => isSunlit(elements, new Date(t + offset * 1000)) !== state,
      );
      if (nearTerminator) {
        skipped += 1;
        continue;
      }
      expect({ at: at.toISOString(), sunlit: isSunlit(ephemeris, at) }).toEqual({ at: at.toISOString(), sunlit: state });
      states.add(state);
      compared += 1;
    }

    // The window checked carries both states, and the skipped band around the crossings stays a small part of it.
    expect(states).toEqual(new Set([true, false]));
    expect(skipped).toBeLessThan(compared / 4);
  });
});

describe("sunAltitude", () => {
  test.each(culminations)("over $search at $at agrees with Skyfield within the tolerance", (culmination) => {
    const altitude = sunAltitude(culmination.observer, new Date(culmination.at));

    expect(Math.abs(altitude - culmination.sunAltitude)).toBeLessThan(passOracle.tolerance.sunAltitudeDegrees);
  });
});
