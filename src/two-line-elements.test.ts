import { propagate as sgp4Propagate, twoline2satrec, eciToGeodetic, gstime } from "satellite.js";
import { describe, expect, test } from "vitest";
import { ElementsError, propagate, readElements, readTwoLineElements } from "./index.js";
import { positionOf } from "./position.js";
import { oracle, positionDistanceKm } from "../test/oracle.js";

// The ISS as CelesTrak served it on 2026-09-19, once as two lines and once
// as an OMM object: one set, epoch 2026-09-19T07:17:41.839008.
const NAME = "ISS (ZARYA)";
const LINE_1 = "1 25544U 98067A   26262.30395647  .00006211  00000+0  12007-3 0  9997";
const LINE_2 = "2 25544  51.6308 194.2901 0004815 157.3949 202.7252 15.49175317586346";
const OMM = {
  OBJECT_NAME: "ISS (ZARYA)",
  OBJECT_ID: "1998-067A",
  EPOCH: "2026-09-19T07:17:41.839008",
  MEAN_MOTION: 15.49175317,
  ECCENTRICITY: 0.0004815,
  INCLINATION: 51.6308,
  RA_OF_ASC_NODE: 194.2901,
  ARG_OF_PERICENTER: 157.3949,
  MEAN_ANOMALY: 202.7252,
  EPHEMERIS_TYPE: 0,
  CLASSIFICATION_TYPE: "U",
  NORAD_CAT_ID: 25544,
  ELEMENT_SET_NO: 999,
  REV_AT_EPOCH: 58634,
  BSTAR: 0.00012007,
  MEAN_MOTION_DOT: 6.211e-5,
  MEAN_MOTION_DDOT: 0,
};

/** The line with its last column rewritten to the modulo-10 checksum of the first 68. */
function withChecksum(line: string): string {
  const body = line.slice(0, 68);
  const sum = [...body].reduce((total, character) => total + (character === "-" ? 1 : /\d/.test(character) ? Number(character) : 0), 0);
  return body + String(sum % 10);
}

/** The line with the columns from `start` (0-based) replaced by `text`, checksum recomputed. */
function edit(line: string, start: number, text: string): string {
  return withChecksum(line.slice(0, start) + text + line.slice(start + text.length));
}

describe("readTwoLineElements reads a TLE pair into the Elements the OMM reader produces", () => {
  test("every field, the epoch and the Catalogue number equal the OMM set's", () => {
    const fromLines = readTwoLineElements(LINE_1, LINE_2, NAME);
    const fromOmm = readElements(OMM);

    expect(fromLines.omm).toEqual(fromOmm.omm);
    expect(fromLines.epoch).toEqual(fromOmm.epoch);
    expect(fromLines.catalogueNumber).toBe(25544);
  });

  test("the Positions agree with the OMM set's over a day, within the Oracle's position tolerance", () => {
    const fromLines = readTwoLineElements(LINE_1, LINE_2, NAME);
    const fromOmm = readElements(OMM);

    for (let minutes = -720; minutes <= 720; minutes += 10) {
      const at = new Date(fromOmm.epoch.getTime() + minutes * 60_000);
      expect(positionDistanceKm(propagate(fromLines, at), propagate(fromOmm, at))).toBeLessThan(oracle.tolerance.positionKm);
    }
  });

  test("the Positions agree with satellite.js's own reading of the lines", () => {
    const elements = readTwoLineElements(LINE_1, LINE_2, NAME);
    const satrec = twoline2satrec(LINE_1, LINE_2);

    for (let minutes = 0; minutes <= 1440; minutes += 60) {
      const at = new Date(elements.epoch.getTime() + minutes * 60_000);
      const state = sgp4Propagate(satrec, at);
      if (state === null) throw new Error("satellite.js did not propagate");
      const expected = positionOf(eciToGeodetic(state.position, gstime(at)));
      expect(positionDistanceKm(propagate(elements, at), expected)).toBeLessThan(oracle.tolerance.positionKm);
    }
  });

  test("without a name the object's name is empty", () => {
    expect(readTwoLineElements(LINE_1, LINE_2).omm.OBJECT_NAME).toBe("");
  });

  test("a name line's padding is trimmed, as CelesTrak pads it to 24 characters", () => {
    expect(readTwoLineElements(LINE_1, LINE_2, "ISS (ZARYA)             ").omm.OBJECT_NAME).toBe(NAME);
  });

  test("trailing whitespace and a carriage return after either line are ignored", () => {
    expect(readTwoLineElements(`${LINE_1}\r`, `${LINE_2}  `, NAME).omm).toEqual(readElements(OMM).omm);
  });

  test("signed exponents, a negative drag term and a twentieth-century epoch read as the standard writes them", () => {
    let line1 = edit(LINE_1, 18, "98262.30395647");
    line1 = edit(line1, 33, "-.00000123");
    line1 = edit(line1, 44, "-12345-5");
    line1 = edit(line1, 53, "-12007-3");
    const omm = readTwoLineElements(line1, LINE_2).omm;

    expect(omm.EPOCH).toBe("1998-09-19T07:17:41.839008");
    expect(omm.MEAN_MOTION_DOT).toBe(-0.00000123);
    expect(omm.MEAN_MOTION_DDOT).toBe(-0.12345e-5);
    expect(omm.BSTAR).toBe(-0.12007e-3);
  });

  test("an object with no international designator has an empty one", () => {
    expect(readTwoLineElements(edit(LINE_1, 9, "        "), LINE_2).omm.OBJECT_ID).toBe("");
  });

  test("an epoch on the first day of the year reads as 1 January", () => {
    expect(readTwoLineElements(edit(LINE_1, 18, "26001.00000000"), LINE_2).omm.EPOCH).toBe("2026-01-01T00:00:00.000000");
  });
});

describe("readTwoLineElements rejects a malformed pair, naming the line", () => {
  test.each([
    ["a first line that is too short", LINE_1.slice(0, 60), LINE_2, "Line 1 is 60 characters, not 69"],
    ["a second line that is too long", LINE_1, `${LINE_2}0`, "Line 2 is 70 characters, not 69"],
    ["the lines swapped", LINE_2, LINE_1, "Line 1 does not start with 1"],
    ["a second line not starting with 2", LINE_1, edit(LINE_2, 0, "3"), "Line 2 does not start with 2"],
    ["a wrong checksum on line 1", LINE_1.slice(0, 68) + "0", LINE_2, "Line 1 checksum is 0, not 7"],
    ["a wrong checksum on line 2", LINE_1, LINE_2.slice(0, 68) + "0", "Line 2 checksum is 0, not 6"],
    ["Catalogue numbers that differ", LINE_1, edit(LINE_2, 2, "25545"), "Line 2 is for 25545, line 1 for 25544"],
    ["a Catalogue number in the five-character encoding", edit(LINE_1, 2, "A0000"), edit(LINE_2, 2, "A0000"), "Line 1 catalogue number A0000 is not a positive integer"],
    ["an unknown classification", edit(LINE_1, 7, "X"), LINE_2, "Line 1 classification X is not U, C or S"],
    ["an epoch day that is not a number", edit(LINE_1, 20, "262.3039564x"), LINE_2, "Line 1 epoch 26262.3039564x is not a year and a day"],
    ["an epoch day beyond the year", edit(LINE_1, 20, "367.00000000"), LINE_2, "Line 1 epoch 26367.00000000 is not a year and a day"],
    ["a drag term that is not a number", edit(LINE_1, 53, " 1200x-3"), LINE_2, "Line 1 drag term 1200x-3 is not a number"],
    ["an inclination that is not a number", LINE_1, edit(LINE_2, 8, " 51.63x8"), "Line 2 inclination 51.63x8 is not a number"],
    ["an eccentricity with a sign", LINE_1, edit(LINE_2, 26, "-004815"), "Line 2 eccentricity -004815 is not a number"],
    ["a mean motion that is blank", LINE_1, edit(LINE_2, 52, "           "), "Line 2 mean motion is not a number"],
    ["a revolution number that is not an integer", LINE_1, edit(LINE_2, 63, "586.4"), "Line 2 revolution number 586.4 is not an integer"],
  ])("%s", (_, line1, line2, reason) => {
    expect(() => readTwoLineElements(line1, line2)).toThrow(ElementsError);
    expect(() => readTwoLineElements(line1, line2)).toThrow(reason);
  });

  test("a pair that describes no orbit fails as an OMM set would", () => {
    expect(() => readTwoLineElements(LINE_1, edit(LINE_2, 52, "20.00000000"))).toThrow("do not propagate");
  });
});
