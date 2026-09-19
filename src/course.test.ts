import geostationaryFixture from "../fixtures/geostationary.json" with { type: "json" };
import { describe, expect, test } from "vitest";
import { course } from "./index.js";
import { degreesApart, fixtureElements, oracle } from "../test/oracle.js";

/**
 * The Course against Skyfield's (`oracle/positions.py`). The
 * oracle measures it as the definition says, from where Skyfield puts the
 * sub-point a second either side of the instant; the engine reads it off
 * the velocity at the instant. Two methods and two propagators agreeing is
 * the proof, and the fixture's own nulls — where Skyfield's sub-point moves
 * slower than a walk — are the Positions that have none.
 */

const geostationarySets = new Set(geostationaryFixture.subjects.filter((subject) => subject.geostationary).map((subject) => subject.elements));
const withCourse = oracle.positions.filter((expected) => expected.course !== null);
const standing = oracle.positions.filter((expected) => expected.course === null);

describe("course", () => {
  test.each(withCourse)("$elements at $at agrees with Skyfield's within the tolerance", (expected) => {
    const answer = course(fixtureElements(expected.elements), new Date(expected.at));

    expect(answer).toBeGreaterThanOrEqual(0);
    expect(answer).toBeLessThan(360);
    expect(degreesApart(answer!, expected.course!)).toBeLessThan(oracle.tolerance.courseDegrees);
  });

  test.each(standing)("$elements at $at, whose sub-point Skyfield has standing, has none", (expected) => {
    expect(course(fixtureElements(expected.elements), new Date(expected.at))).toBeUndefined();
  });

  test("the Positions with none are exactly those of the sets Skyfield's propagation shows to be Geostationary", () => {
    expect(new Set(standing.map((expected) => expected.elements))).toEqual(geostationarySets);
    expect(geostationarySets.size).toBe(3);
  });
});
