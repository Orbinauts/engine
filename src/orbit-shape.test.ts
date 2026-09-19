import geostationaryFixture from "../fixtures/geostationary.json" with { type: "json" };
import { describe, expect, test } from "vitest";
import { constants } from "satellite.js";
import { apsides, circularPeriodSeconds, isGeostationary, isSunlit, nextLightChange, orbitalPeriodSeconds, orbitPhase, semiMajorAxisKm } from "./index.js";
import { degreesApart, fixtureElements, oracle } from "../test/oracle.js";

/**
 * The orbit's shape and phase against Skyfield's reading of the
 * same Elements (`oracle/positions.py`). The apsides are SGP4's
 * own, out of the record both libraries initialise from the same fields;
 * the phase is the mean anomaly carried forward at the mean motion, which
 * the oracle works out from its own reading of the OMM and of the epoch,
 * so what the fixture proves is the units and the epoch arithmetic: the
 * phase is held to an independent reading, not to the SatRec read twice.
 */

describe("apsides", () => {
  test.each(Object.entries(oracle.elements))("of %s are the heights SGP4's record gives Skyfield", (key, set) => {
    const { apogeeKm, perigeeKm } = apsides(fixtureElements(key));

    expect(Math.abs(apogeeKm - set.apogeeKm)).toBeLessThan(oracle.tolerance.apsidesKm);
    expect(Math.abs(perigeeKm - set.perigeeKm)).toBeLessThan(oracle.tolerance.apsidesKm);
    expect(perigeeKm).toBeLessThanOrEqual(apogeeKm);
  });

  test("the ISS flies between about 410 and 430 km, Chandra from about 12,000 to 137,000", () => {
    const iss = apsides(fixtureElements("iss-2026-09-19"));
    expect(iss.perigeeKm).toBeGreaterThan(400);
    expect(iss.apogeeKm).toBeLessThan(440);
    const chandra = apsides(fixtureElements("chandra-2026-09-21"));
    expect(chandra.perigeeKm).toBeGreaterThan(11_000);
    expect(chandra.perigeeKm).toBeLessThan(14_000);
    expect(chandra.apogeeKm).toBeGreaterThan(130_000);
    expect(chandra.apogeeKm).toBeLessThan(140_000);
  });
});

describe("semiMajorAxisKm", () => {
  test.each(Object.entries(oracle.elements))("of %s's mean motion is the axis SGP4's record gives Skyfield, less the un-Kozai correction", (key, set) => {
    const { omm } = fixtureElements(key);
    // The apsides are heights above SGP4's own Earth radius, WGS72's.
    const recordAxisKm = (set.apogeeKm + set.perigeeKm) / 2 + constants.earthRadius;

    expect(Math.abs(semiMajorAxisKm(omm.MEAN_MOTION) - recordAxisKm) / recordAxisKm).toBeLessThan(1e-3);
  });

  test("one turn a sidereal day is the geostationary radius, and a slower turn a higher orbit", () => {
    expect(semiMajorAxisKm(86_400 / 86_164.0905)).toBeCloseTo(42_164.2, 0);
    // The ISS: a thousandth of a revolution a day less is about 290 metres higher.
    expect((semiMajorAxisKm(15.48880167) - semiMajorAxisKm(15.48980167)) * 1_000).toBeCloseTo(292.5, 0);
  });
});

describe("circularPeriodSeconds", () => {
  test("a circular orbit at an altitude turns in the time Kepler gives it: geostationary height in a sidereal day, the ISS's in about 93 minutes", () => {
    expect(circularPeriodSeconds(42_164.2 - constants.earthRadius)).toBeCloseTo(86_164, -2);
    expect(circularPeriodSeconds(410) / 60).toBeCloseTo(92.8, 1);
    // A lower orbit goes round the sooner, which is the comparison the column it fills is for.
    expect(circularPeriodSeconds(390)).toBeLessThan(circularPeriodSeconds(410));
  });

  test("it agrees with the mean motion the Elements of a near-circular orbit carry, to a few seconds", () => {
    const elements = fixtureElements("iss-2026-09-19");
    const { apogeeKm, perigeeKm } = apsides(elements);

    expect(circularPeriodSeconds((apogeeKm + perigeeKm) / 2)).toBeCloseTo(orbitalPeriodSeconds(elements), -1);
  });
});

describe("orbitPhase", () => {
  test.each(oracle.positions)("$elements at $at is the mean anomaly Skyfield carries forward, as a fraction of a turn", (expected) => {
    const phase = orbitPhase(fixtureElements(expected.elements), new Date(expected.at));

    expect(phase.fraction).toBeGreaterThanOrEqual(0);
    expect(phase.fraction).toBeLessThan(1);
    expect(degreesApart(phase.fraction * 360, expected.meanAnomalyDegrees)).toBeLessThan(oracle.tolerance.meanAnomalyDegrees);
  });

  test("completes in the rest of the period, and wraps once an orbit", () => {
    const elements = fixtureElements("iss-2026-09-19");
    const period = orbitalPeriodSeconds(elements);
    const atEpoch = orbitPhase(elements, elements.epoch);
    // The ISS set's mean anomaly at its epoch is 202.7252 degrees.
    expect(atEpoch.fraction).toBeCloseTo(202.7252 / 360, 6);
    expect(atEpoch.periodSeconds).toBe(period);
    expect(atEpoch.completesInSeconds).toBeCloseTo((1 - 202.7252 / 360) * period, 3);
    // A quarter of a period later the fraction has advanced by a quarter, and half a period later it has wrapped…
    const quarter = orbitPhase(elements, new Date(elements.epoch.getTime() + (period / 4) * 1000));
    expect(quarter.fraction).toBeCloseTo(atEpoch.fraction + 0.25, 6);
    const half = orbitPhase(elements, new Date(elements.epoch.getTime() + (period / 2) * 1000));
    expect(half.fraction).toBeCloseTo(atEpoch.fraction + 0.5 - 1, 6);
    // …and a whole period later it is back where it was, before the epoch as well as after.
    expect(orbitPhase(elements, new Date(elements.epoch.getTime() + period * 1000)).fraction).toBeCloseTo(atEpoch.fraction, 6);
    expect(orbitPhase(elements, new Date(elements.epoch.getTime() - period * 1000)).fraction).toBeCloseTo(atEpoch.fraction, 6);
  });

  test.each(Object.keys(oracle.elements))("of %s says when the orbit began and when it ends: the perigees either side of the instant, one period apart", (key) => {
    const elements = fixtureElements(key);
    const at = new Date(elements.epoch.getTime() + 1_234_567);
    const phase = orbitPhase(elements, at);

    expect(phase.began.getTime()).toBeLessThanOrEqual(at.getTime());
    expect(phase.ends.getTime()).toBeGreaterThan(at.getTime());
    // A Date holds whole milliseconds, so each instant is within one of the reckoning.
    expect(Math.abs(phase.ends.getTime() - phase.began.getTime() - phase.periodSeconds * 1000)).toBeLessThanOrEqual(1);
    expect(Math.abs(phase.ends.getTime() - at.getTime() - phase.completesInSeconds * 1000)).toBeLessThanOrEqual(1);
    // At either end the phase is back at perigee: a fraction of nothing, or of all but nothing.
    for (const end of [phase.began, phase.ends]) {
      const { fraction } = orbitPhase(elements, end);
      expect(Math.min(fraction, 1 - fraction)).toBeLessThan(1e-6);
    }
    // And the orbit that ends is where the next one begins.
    const next = orbitPhase(elements, new Date(phase.ends.getTime() + 1000));
    expect(Math.abs(next.began.getTime() - phase.ends.getTime())).toBeLessThanOrEqual(2);
  });
});

describe("nextLightChange", () => {
  const geostationary = new Set(geostationaryFixture.subjects.filter((subject) => subject.geostationary).map((subject) => subject.elements));
  const lowSets = Object.keys(oracle.elements).filter((key) => !geostationary.has(key) && orbitalPeriodSeconds(fixtureElements(key)) < 4 * 3600);

  test.each(lowSets)("of %s is within a period, and the light differs a second either side of it", (key) => {
    const elements = fixtureElements(key);
    const at = elements.epoch;
    const period = orbitalPeriodSeconds(elements);

    const change = nextLightChange(elements, at, period);
    expect(change).toBeDefined();
    expect(change!.getTime()).toBeGreaterThan(at.getTime());
    expect(change!.getTime() - at.getTime()).toBeLessThanOrEqual(period * 1000);
    const before = new Date(change!.getTime() - 1000);
    const after = new Date(change!.getTime() + 1000);
    expect(isSunlit(elements, before)).toBe(isSunlit(elements, at));
    expect(isSunlit(elements, after)).not.toBe(isSunlit(elements, at));
  });

  test("the ISS at its September 2026 epoch goes into the shadow within the hour, and comes out within the next", () => {
    const elements = fixtureElements("iss-2026-09-19");
    const first = nextLightChange(elements, elements.epoch, 3600)!;
    const second = nextLightChange(elements, first, 3600)!;
    expect(isSunlit(elements, elements.epoch)).not.toBe(isSunlit(elements, new Date(first.getTime() + 1000)));
    expect(second.getTime() - first.getTime()).toBeGreaterThan(20 * 60_000);
    expect(second.getTime() - first.getTime()).toBeLessThan(40 * 60_000);
  });

  test("a Geostationary Satellite in sunlight outside its eclipse season has no change to report within a day", () => {
    const elements = fixtureElements("goes-19-2026-09-19");
    expect(isGeostationary(elements)).toBe(true);
    // GOES-19's eclipse seasons fall around the equinoxes; the day below is
    // a month before the September one, ahead of its season, and the sample
    // at a minute would find an eclipse of any length that occurred.
    expect(nextLightChange(elements, new Date("2026-08-20T12:00:00Z"), 86_400)).toBeUndefined();
  });
});
