import geostationaryFixture from "../fixtures/geostationary.json" with { type: "json" };
import { describe, expect, test } from "vitest";
import { fixtureElements } from "../test/oracle.js";
import {
  GEOSTATIONARY_MAX_ECCENTRICITY,
  GEOSTATIONARY_MAX_INCLINATION_DEGREES,
  GEOSTATIONARY_MEAN_MOTION,
  GEOSTATIONARY_MEAN_MOTION_BAND,
  isGeostationary,
} from "./geostationary.js";
import { isInView } from "./in-view.js";
import { findPasses, PassesNotDefinedError, VISIBLE_MIN_ELEVATION } from "./passes.js";
import { propagate } from "./position.js";
import { readElements, type Elements, type Omm } from "./index.js";

/**
 * The Geostationary rule against Skyfield's own
 * answer for the same Elements (`oracle/geostationary.py`), and then at
 * each of its three bounds.
 */

/** Madrid, and ten days: a long search, so that a Pass the rule missed would have every chance to show. */
const MADRID = { latitude: 40.4168, longitude: -3.7038, altitude: 657 };
const TEN_DAYS = { from: new Date("2026-09-25T00:00:00Z"), to: new Date("2026-10-05T00:00:00Z") };

/** How far the sub-point of a Satellite the rule accepts may wander, in degrees: the widest the oracle found, with room over it. */
const STANDS_WITHIN_DEGREES = 2;

/** The GOES-19 Elements with fields replaced: a set at a chosen distance from each bound. */
function goesWith(changes: Partial<Omm>): Elements {
  return readElements({ ...fixtureElements("goes-19-2026-09-19").omm, ...changes });
}

describe("Geostationary, read from the Elements", () => {
  for (const subject of geostationaryFixture.subjects) {
    test(`${subject.elements} is ${subject.geostationary ? "" : "not "}Geostationary, and Skyfield's own propagation says the same`, () => {
      expect(isGeostationary(fixtureElements(subject.elements))).toBe(subject.geostationary);

      if (subject.geostationary) {
        // It stands over one longitude of the equator, and no Observer
        // clear of the edge of what it sees ever watches it rise or set.
        expect(subject.subPoint.latitudeSpanDegrees).toBeLessThan(STANDS_WITHIN_DEGREES);
        expect(subject.subPoint.longitudeSpanDegrees).toBeLessThan(STANDS_WITHIN_DEGREES);
        expect(subject.horizon.seeingACrossing).toBe(0);
      } else {
        // It crosses the sky: a figure of eight over a third of the Earth,
        // and most of the world sees it rise and set.
        expect(subject.subPoint.latitudeSpanDegrees).toBeGreaterThan(100);
        expect(subject.horizon.seeingACrossing).toBeGreaterThan(subject.horizon.observers / 2);
      }
      expect(subject.horizon.observers).toBeGreaterThan(500);
    });
  }

  test("the mean motion band is one degree of longitude a day either side of a sidereal day's rate", () => {
    expect(GEOSTATIONARY_MEAN_MOTION).toBeCloseTo(86_400 / 86_164.0905, 9);
    // A day's drift is 360 degrees times the difference from the sidereal rate.
    expect(360 * GEOSTATIONARY_MEAN_MOTION_BAND).toBeCloseTo(1, 2);

    expect(isGeostationary(goesWith({ MEAN_MOTION: GEOSTATIONARY_MEAN_MOTION + GEOSTATIONARY_MEAN_MOTION_BAND }))).toBe(true);
    expect(isGeostationary(goesWith({ MEAN_MOTION: GEOSTATIONARY_MEAN_MOTION - GEOSTATIONARY_MEAN_MOTION_BAND }))).toBe(true);
    expect(isGeostationary(goesWith({ MEAN_MOTION: GEOSTATIONARY_MEAN_MOTION + 2 * GEOSTATIONARY_MEAN_MOTION_BAND }))).toBe(false);
    // Twice a sidereal day's rate is a navigation Satellite's orbit, not this one.
    expect(isGeostationary(goesWith({ MEAN_MOTION: 2 * GEOSTATIONARY_MEAN_MOTION }))).toBe(false);
  });

  test("an eccentric orbit is not Geostationary however long it takes: it stands over no one longitude", () => {
    expect(isGeostationary(goesWith({ ECCENTRICITY: GEOSTATIONARY_MAX_ECCENTRICITY }))).toBe(true);
    expect(isGeostationary(goesWith({ ECCENTRICITY: GEOSTATIONARY_MAX_ECCENTRICITY * 2 }))).toBe(false);
  });

  test("an inclined geosynchronous orbit is not Geostationary: it traces a figure of eight across the sky", () => {
    expect(isGeostationary(goesWith({ INCLINATION: GEOSTATIONARY_MAX_INCLINATION_DEGREES }))).toBe(true);
    expect(isGeostationary(goesWith({ INCLINATION: GEOSTATIONARY_MAX_INCLINATION_DEGREES + 0.1 }))).toBe(false);
  });

  /**
   * The inclination is the only bound any tracked Satellite comes near — the
   * four fixture sets are inclined by under a degree or by 59 — so it is
   * the one worth measuring at its edge. The oracle propagates GOES-19 with
   * its orbit tilted to exactly the bound and reports what accepting it
   * costs, which is what the constant's own reason claims.
   */
  test("at the inclination bound the Satellite still stands over one longitude, and the Passes the rule refuses with it graze the horizon", () => {
    const bound = geostationaryFixture.atTheBound;

    expect(bound.inclinationDegrees).toBe(GEOSTATIONARY_MAX_INCLINATION_DEGREES);
    expect(isGeostationary(goesWith({ INCLINATION: bound.inclinationDegrees }))).toBe(true);
    // The sub-point swings twice the inclination in latitude and no more.
    expect(bound.subPointLatitudeSpanDegrees).toBeCloseTo(2 * GEOSTATIONARY_MAX_INCLINATION_DEGREES, 1);
    // Under a tenth of the Earth sees it cross a horizon at all: the ring
    // at the edge of its Footprint, where a swing of five degrees carries
    // it over and back.
    expect(bound.seeingACrossing).toBeLessThan(bound.observers / 10);
    // And for those Observers it only grazes: it never reaches the
    // elevation the Visible window's rule needs, so nothing a person could
    // have watched is refused with them.
    expect(bound.visibleMinElevationDegrees).toBe(VISIBLE_MIN_ELEVATION);
    expect(bound.highestCrossingElevationDegrees).toBeLessThan(VISIBLE_MIN_ELEVATION);
  });

  test("the Satellites with Passes are not Geostationary, so nothing the rule adds refuses them", () => {
    for (const key of ["iss-2026-09-19", "tiangong-2026-09-19", "hubble-2026-09-19", "saramago-2026-09-18"]) {
      expect(isGeostationary(fixtureElements(key)), key).toBe(false);
    }
  });
});

describe("the Pass search over Geostationary Elements", () => {
  test("refuses them with its own error rather than searching: no Observer ever sees one cross the horizon, so the Elements say it before any walk", () => {
    const startedAt = performance.now();

    expect(() => findPasses(fixtureElements("goes-19-2026-09-19"), MADRID, TEN_DAYS)).toThrow(PassesNotDefinedError);

    expect(performance.now() - startedAt).toBeLessThan(500);
  });

  test("the error names the Satellite by its catalogue number and says the Satellite never rises or sets", () => {
    expect(() => findPasses(fixtureElements("hispasat-30w-6-2026-09-19"), MADRID, TEN_DAYS)).toThrow(/43228.*never rises or sets/);
  });

  test("an inclined geosynchronous Satellite is searched as any other: it rises and sets once a sidereal day", () => {
    const passes = findPasses(fixtureElements("beidou-3-igso-1-2026-09-18"), MADRID, TEN_DAYS);

    // One long Pass a day: it climbs 15 degrees over Madrid for some five
    // hours a night, four minutes earlier each day as the sidereal day runs.
    expect(passes).toHaveLength(11);
    for (const pass of passes) {
      const hours = (pass.set.at.getTime() - pass.rise.at.getTime()) / 3_600_000;
      expect(hours).toBeGreaterThan(4);
      expect(hours).toBeLessThan(6);
      expect(pass.culmination.elevation).toBeCloseTo(15, 0);
    }
  });

  test("over an Observer that sees it the whole window it has no Pass, and the search says so at once rather than walking back for a rise that never came", () => {
    const igso = fixtureElements("beidou-3-igso-1-2026-09-18");
    // Kuala Lumpur, near the middle of its figure of eight: Skyfield finds
    // Observers who never watch it cross the horizon in ten days
    // (`oracle/geostationary.py`, 127 of the 580), and this is one of them,
    // In view at every five-minute instant of the window.
    const kualaLumpur = { latitude: 3.14, longitude: 101.69, altitude: 0 };
    for (let t = TEN_DAYS.from.getTime(); t <= TEN_DAYS.to.getTime(); t += 300_000) {
      expect(isInView(propagate(igso, new Date(t)), kualaLumpur), new Date(t).toISOString()).toBe(true);
    }
    const startedAt = performance.now();

    expect(findPasses(igso, kualaLumpur, TEN_DAYS)).toEqual([]);

    expect(performance.now() - startedAt).toBeLessThan(500);
  });
});
