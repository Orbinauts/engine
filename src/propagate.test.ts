import { describe, expect, test } from "vitest";
import { orbitalPeriodSeconds, orbitalSpeed, propagate } from "./index.js";
import { fixtureElements, oracle, positionDistanceKm } from "../test/oracle.js";

const tolerance = oracle.tolerance.positionKm;

describe("readElements", () => {
  test.each(Object.entries(oracle.elements))("derives the Catalogue number and the epoch of %s as Skyfield does", (key, set) => {
    const elements = fixtureElements(key);

    expect(elements.catalogueNumber).toBe(set.catalogueNumber);
    expect(elements.epoch.toISOString()).toBe(set.epoch);
  });

  test("a six-digit Catalogue number is a plain integer", () => {
    expect(fixtureElements("saramago-2026-09-18").catalogueNumber).toBe(100000);
  });
});

describe("orbitalPeriodSeconds", () => {
  test.each(Object.entries(oracle.elements))("of %s agrees with Skyfield's reading of the mean motion", (key, set) => {
    const period = orbitalPeriodSeconds(fixtureElements(key));

    expect(Math.abs(period - set.periodSeconds)).toBeLessThan(oracle.tolerance.periodSeconds);
  });

  test("is about 93 minutes for the ISS", () => {
    expect(orbitalPeriodSeconds(fixtureElements("iss-2026-09-19"))).toBeCloseTo(5577.16, 1);
  });
});

describe("propagate", () => {
  test.each(oracle.positions)("$elements at $at agrees with Skyfield within the tolerance", (expected) => {
    const position = propagate(fixtureElements(expected.elements), new Date(expected.at));

    expect(positionDistanceKm(position, expected)).toBeLessThan(tolerance);
  });
});

describe("orbitalSpeed", () => {
  test.each(oracle.positions)("$elements at $at agrees with Skyfield within the tolerance", (expected) => {
    const speed = orbitalSpeed(fixtureElements(expected.elements), new Date(expected.at));

    expect(Math.abs(speed - expected.speedKmPerSecond)).toBeLessThan(oracle.tolerance.speedKmPerSecond);
  });
});
