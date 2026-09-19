import { describe, expect, test } from "vitest";
import { applySourceRule, parseEphemeris, sourceAge } from "./index.js";
import { ephemerisOracle, fixtureElements, fixtureEphemerisText } from "../test/oracle.js";

const elements = fixtureElements(ephemerisOracle.elements);
const ephemeris = parseEphemeris(fixtureEphemerisText());
// The fixture Ephemeris was issued on 2026-09-19T15:15:51.545Z and covers 2026-09-19T12:00 to 2026-09-21T13:00.
const covered = { from: new Date("2026-09-20T08:00:00Z"), to: new Date("2026-09-21T08:00:00Z") };
const instant = (at: string) => ({ from: new Date(at), to: new Date(at) });
/** The freshness limit is the caller's to choose; these tests mostly ask for a week. */
const WEEK = 7;

describe("the Source rule chooses the Ephemeris when it covers the interval and is fresh", () => {
  test("a covered interval, the Ephemeris issued within the limit", () => {
    expect(applySourceRule({ elements, ephemeris }, covered, new Date("2026-09-20T08:00:00Z"), WEEK)).toBe(ephemeris);
    expect(applySourceRule({ elements, ephemeris }, covered, new Date("2026-09-26T15:15:51Z"), WEEK)).toBe(ephemeris);
  });

  test("an instant is an interval of no length", () => {
    expect(applySourceRule({ elements, ephemeris }, instant("2026-09-21T13:00:00Z"), new Date("2026-09-20T08:00:00Z"), WEEK)).toBe(ephemeris);
    expect(applySourceRule({ elements, ephemeris }, instant("2026-09-21T13:00:00.001Z"), new Date("2026-09-20T08:00:00Z"), WEEK)).toBe(elements);
  });

  test("an interval reaching beyond the Ephemeris falls back to the Elements", () => {
    const beyond = { from: covered.from, to: new Date("2026-09-30T08:00:00Z") };
    expect(applySourceRule({ elements, ephemeris }, beyond, new Date("2026-09-20T08:00:00Z"), WEEK)).toBe(elements);
  });

  test("an Ephemeris issued as long ago as the limit or longer falls back to the Elements", () => {
    expect(applySourceRule({ elements, ephemeris }, covered, new Date("2026-09-26T15:15:52Z"), WEEK)).toBe(elements);
  });

  test("the limit is the caller's: the same Ephemeris is fresh under a longer one and stale under a shorter one", () => {
    const nineDaysOn = new Date("2026-09-28T15:15:51Z");
    expect(applySourceRule({ elements, ephemeris }, covered, nineDaysOn, WEEK)).toBe(elements);
    expect(applySourceRule({ elements, ephemeris }, covered, nineDaysOn, 10)).toBe(ephemeris);
    expect(applySourceRule({ elements, ephemeris }, covered, new Date("2026-09-20T15:15:51Z"), 1)).toBe(ephemeris);
    expect(applySourceRule({ elements, ephemeris }, covered, new Date("2026-09-20T15:15:52Z"), 1)).toBe(elements);
  });

  test("without an Ephemeris the Elements answer", () => {
    expect(applySourceRule({ elements, ephemeris: undefined }, covered, new Date("2026-09-20T08:00:00Z"), WEEK)).toBe(elements);
  });
});

test("sourceAge of an Ephemeris is the whole seconds elapsed since it was issued", () => {
  expect(sourceAge(ephemeris, new Date("2026-09-19T16:15:51.545Z"))).toBe(3600);
  expect(sourceAge(ephemeris, new Date("2026-09-19T16:15:52.500Z"))).toBe(3600);
});
