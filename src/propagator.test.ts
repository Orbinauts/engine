import { describe, expect, test } from "vitest";
import { course, isSunlit, orbitalSpeed, propagate, propagator } from "./index.js";
import { degreesApart, fixtureElements, oracle } from "../test/oracle.js";

/**
 * The propagator: built once from Elements, it answers every instant after
 * without building its state again. Against the Skyfield fixtures
 * (`oracle/positions.py`) it must answer what the one-shot propagation
 * answers, to the bit, so that a map that builds one per set of Elements
 * draws exactly what it would draw if it propagated afresh
 * every second; and the velocity over the ground it carries must point
 * where Skyfield's sub-point moves.
 */

const withCourse = oracle.positions.filter((expected) => expected.course !== null);
const standing = oracle.positions.filter((expected) => expected.course === null);

/** One propagator per fixture set, built once and asked every instant of that set: what a live map does. */
const built = new Map(Object.keys(oracle.elements).map((key) => [key, propagator(fixtureElements(key))]));
const propagatorOf = (key: string) => built.get(key)!;

describe("propagator", () => {
  test.each(oracle.positions)("$elements at $at answers the Position, speed, Course and Sunlit state the one-shot propagation does, to the bit", (expected) => {
    const elements = fixtureElements(expected.elements);
    const at = new Date(expected.at);

    const state = propagatorOf(expected.elements).stateAt(at);

    expect(state.position).toEqual(propagate(elements, at));
    expect(state.speed).toBe(orbitalSpeed(elements, at));
    expect(state.course).toBe(course(elements, at));
    expect(state.sunlit).toBe(isSunlit(elements, at));
  });

  test.each(withCourse)("$elements at $at moves over the ground along Skyfield's Course", (expected) => {
    const { groundVelocity } = propagatorOf(expected.elements).stateAt(new Date(expected.at));

    const heading = (Math.atan2(groundVelocity.east, groundVelocity.north) * 180) / Math.PI;
    expect(degreesApart((heading + 360) % 360, expected.course!)).toBeLessThan(oracle.tolerance.courseDegrees);
  });

  test.each(standing)("$elements at $at, whose sub-point Skyfield has standing, has no Course and barely moves over the ground", (expected) => {
    const { course, groundVelocity } = propagatorOf(expected.elements).stateAt(new Date(expected.at));

    expect(course).toBeUndefined();
    // Metres a second where a low orbit's sub-point runs at kilometres a second.
    expect(Math.hypot(groundVelocity.north, groundVelocity.east)).toBeLessThan(0.05);
  });

  test("a low orbit's sub-point runs over the ground a little slower than the Satellite flies", () => {
    const expected = oracle.positions.find((position) => position.elements === "iss-2026-09-19")!;

    const state = propagatorOf(expected.elements).stateAt(new Date(expected.at));

    // 7.66 km/s through space, a sub-point 400 km below moving about 6% slower, less or more the Earth's turning.
    const overGround = Math.hypot(state.groundVelocity.north, state.groundVelocity.east);
    expect(overGround).toBeGreaterThan(6.5);
    expect(overGround).toBeLessThan(state.speed);
  });

  test("answers any instant in any order, since nothing it holds moves with the instants it is asked", () => {
    const expected = oracle.positions.filter((position) => position.elements === "iss-2026-09-19");
    const iss = propagatorOf("iss-2026-09-19");

    const forwards = expected.map((position) => iss.stateAt(new Date(position.at)));
    const backwards = [...expected].reverse().map((position) => iss.stateAt(new Date(position.at)));

    expect(backwards.reverse()).toEqual(forwards);
  });

  test("carries the Elements it was built from", () => {
    const elements = fixtureElements("hubble-2026-09-19");

    expect(propagator(elements).elements).toBe(elements);
  });
});
