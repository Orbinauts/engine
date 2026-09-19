import { describe, expect, test } from "vitest";
import { ElementsError, OMM_FIELDS, readElements } from "./index.js";
import { oracle } from "../test/oracle.js";

const published = oracle.elements["iss-2026-09-19"].omm;

test("the engine's field list is the oracle's, in the standard's order", () => {
  // positions.py writes each set in its own OMM_FIELDS order; the two runtimes must agree field for field.
  expect([...OMM_FIELDS]).toEqual(Object.keys(published));
});

describe("readElements reads the OMM object as it is served", () => {
  test("the Catalogue number and the epoch are derived from it", () => {
    const elements = readElements(published);

    expect(elements.catalogueNumber).toBe(25544);
    expect(elements.epoch.toISOString()).toBe("2026-09-19T07:17:41.839Z");
    expect(elements.omm).toEqual(published);
  });

  test("numeric fields Space-Track serves as text read as numbers", () => {
    const asText = Object.fromEntries(
      Object.entries(published).map(([name, value]) => [name, typeof value === "number" ? String(value) : value]),
    );

    expect(readElements(asText).omm).toEqual(published);
  });

  test("an epoch with a zone designator reads the same", () => {
    expect(readElements({ ...published, EPOCH: `${published.EPOCH}Z` }).epoch).toEqual(readElements(published).epoch);
  });

  test("fields outside the message are left out", () => {
    const elements = readElements({ ...published, TLE_LINE1: "1 25544U 98067A ...", GP_ID: 345381498 });

    expect(elements.omm).toEqual(published);
  });
});

describe("readElements rejects Elements that cannot be trusted", () => {
  const without = (name: string) => Object.fromEntries(Object.entries(published).filter(([field]) => field !== name));

  test.each([
    ["text instead of an object", "1 25544U 98067A   26246.56303513  .00003925  00000+0  79431-4 0  9992", "not an object"],
    ["a missing field", without("MEAN_MOTION"), "MEAN_MOTION is missing"],
    ["a null field", { ...published, BSTAR: null }, "BSTAR is missing"],
    ["a numeric field holding other text", { ...published, INCLINATION: "xx.xxxx" }, "INCLINATION is not a finite number"],
    ["a numeric field holding empty text", { ...published, ECCENTRICITY: "" }, "ECCENTRICITY is not a finite number"],
    ["a non-finite value", { ...published, MEAN_MOTION: Infinity }, "MEAN_MOTION is not a finite number"],
    ["a NaN value", { ...published, RA_OF_ASC_NODE: NaN }, "RA_OF_ASC_NODE is not a finite number"],
    ["a name that is not text", { ...published, OBJECT_NAME: 25544 }, "OBJECT_NAME is not text"],
    ["an epoch in the old day-of-year form", { ...published, EPOCH: "26246.56303513" }, "EPOCH is not a UTC instant"],
    ["an epoch of an impossible date", { ...published, EPOCH: "2026-13-03T13:30:46.235232" }, "EPOCH is not a UTC instant"],
    ["a Catalogue number that is not an integer", { ...published, NORAD_CAT_ID: 25544.5 }, "NORAD_CAT_ID is not an integer"],
    ["a Catalogue number in the five-character encoding", { ...published, NORAD_CAT_ID: "A0000" }, "NORAD_CAT_ID is not a finite number"],
    ["a Catalogue number of zero", { ...published, NORAD_CAT_ID: 0 }, "NORAD_CAT_ID is not a positive integer"],
    ["a theory other than SGP4", { ...published, EPHEMERIS_TYPE: 4 }, "EPHEMERIS_TYPE 4 is not SGP4"],
    ["a classification the catalogue does not use", { ...published, CLASSIFICATION_TYPE: "X" }, "CLASSIFICATION_TYPE X is not U, C or S"],
    ["a mean motion of an orbit inside the Earth", { ...published, MEAN_MOTION: 20 }, "do not propagate"],
    ["an eccentricity of one or more", { ...published, ECCENTRICITY: 1.5 }, "do not propagate"],
    ["a negative mean motion", { ...published, MEAN_MOTION: -1 }, "do not propagate"],
  ])("%s", (_, corrupted, reason) => {
    expect(() => readElements(corrupted)).toThrow(ElementsError);
    expect(() => readElements(corrupted)).toThrow(reason);
  });
});
