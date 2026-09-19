import { describe, expect, test } from "vitest";
import { footprint, footprintAngleDegrees, footprintRadiusKm, latitudeBandDegrees, propagate, readElements } from "./index.js";
import { fixtureElements, oracle, positionDistanceKm } from "../test/oracle.js";

describe("footprintRadiusKm", () => {
  // On a sphere of mean radius 6371.0088 km, the horizon seen from 400 km up
  // is 19.79 degrees of arc away, 2200.8 km along the ground.
  test("is the ground distance to the horizon for a Satellite at an altitude", () => {
    expect(footprintRadiusKm(400)).toBeCloseTo(2200.8, 1);
    expect(footprintRadiusKm(420)).toBeCloseTo(2252.4, 1);
  });

  test("is zero on the ground", () => {
    expect(footprintRadiusKm(0)).toBe(0);
  });

  // The reach where the Satellite stands at least 10 degrees up: the
  // ring of the Earth-centred angle acos(R cos e / (R + h)) - e.
  test("narrows to where the Satellite stands at least an elevation above the horizon", () => {
    expect(footprintRadiusKm(420, 0)).toBe(footprintRadiusKm(420));
    expect(footprintRadiusKm(420, 10)).toBeCloseTo(1389.6, 1);
    expect(footprintRadiusKm(20_200, 10)).toBeCloseTo(7376.9, 1);
    expect(footprintAngleDegrees(400, 10)).toBeCloseTo(12.085, 3);
  });

  test.each([400, 420, 800, 20_200, 35_786])("from the edge of the ring at %d km, the Satellite stands at the elevation asked for", (altitudeKm) => {
    const radius = 6371.0088;
    const angle = (footprintAngleDegrees(altitudeKm, 10) * Math.PI) / 180;
    // The triangle of the Earth's centre, the Observer on the ring's edge and the Satellite: its elevation from the two sides and the angle between them.
    const slant = Math.sqrt(radius ** 2 + (radius + altitudeKm) ** 2 - 2 * radius * (radius + altitudeKm) * Math.cos(angle));
    const elevation = (Math.asin(((radius + altitudeKm) * Math.cos(angle) - radius) / slant) * 180) / Math.PI;
    expect(elevation).toBeCloseTo(10, 9);
  });
});

/**
 * The band of latitudes a Satellite is seen from: the furthest its ground
 * track goes, which is its inclination, plus the Footprint's reach past it
 * at the elevation that clears a real horizon. The numbers below are those
 * of each Satellite's own Elements.
 */
describe("latitudeBandDegrees", () => {
  test("is the inclination plus the Footprint's half-angle at the elevation", () => {
    // The ISS: 51.63 degrees of inclination and 12.09 of reach from 400 km up at 10 degrees.
    expect(latitudeBandDegrees(fixtureElements("iss-2026-09-19").omm.INCLINATION, 400, 10)).toBeCloseTo(63.72, 2);
    // Hubble: 28.47 degrees and 13.39 from 465 km up.
    expect(latitudeBandDegrees(fixtureElements("hubble-2026-09-19").omm.INCLINATION, 465, 10)).toBeCloseTo(41.86, 2);
  });

  test("reads a retrograde inclination as the furthest its ground track goes, which is what the half turn leaves of it", () => {
    // Terra is sun-synchronous at 98 degrees, so its track reaches 82 north and south and its Footprint the rest.
    expect(fixtureElements("terra-2026-09-19").omm.INCLINATION).toBeGreaterThan(90);
    expect(latitudeBandDegrees(97.9387, 688, 10)).toBe(90);
    expect(latitudeBandDegrees(97.9387, 688)).toBe(90);
    expect(latitudeBandDegrees(120, 400, 10)).toBeCloseTo(60 + footprintAngleDegrees(400, 10), 9);
  });

  test("never passes the pole: a band is a latitude, not a number of degrees walked", () => {
    expect(latitudeBandDegrees(90, 20_200, 10)).toBe(90);
    expect(latitudeBandDegrees(51.6, 35_786, 10)).toBe(90);
  });

  test("an equatorial orbit is seen from as far as its Footprint reaches, and no further", () => {
    expect(latitudeBandDegrees(0, 400, 10)).toBeCloseTo(footprintAngleDegrees(400, 10), 9);
    expect(latitudeBandDegrees(0, 400)).toBeCloseTo(footprintAngleDegrees(400), 9);
  });

  test("the ISS's own track reaches its inclination, and the band reaches further", () => {
    const elements = fixtureElements("iss-2026-09-19");
    const band = latitudeBandDegrees(elements.omm.INCLINATION, 400, 10);
    // An orbit and a half of sub-points: the highest reaches the
    // inclination, to within the fifth of a degree by which a geodetic
    // latitude on the ellipsoid runs past the angle the orbit is inclined
    // at, and every one of them is well inside the band.
    const latitudes = Array.from({ length: 140 }, (_, minute) => Math.abs(propagate(elements, new Date(elements.epoch.getTime() + minute * 60_000)).latitude));

    expect(Math.max(...latitudes)).toBeCloseTo(elements.omm.INCLINATION, 0);
    expect(latitudes.every((latitude) => latitude < band)).toBe(true);
  });
});

describe("footprint", () => {
  test.each(oracle.footprints)("the ring around $elements at $at sits on the horizon Skyfield sees", (expected) => {
    const ring = footprint(expected.centre, expected.ring.length);

    for (const [index, point] of ring.entries()) {
      expect(positionDistanceKm({ ...point, altitude: 0 }, { ...expected.ring[index]!, altitude: 0 })).toBeLessThan(oracle.tolerance.footprintKm);
    }
  });

  test("starts due north of the centre and keeps longitudes within 180 degrees", () => {
    const ring = footprint({ latitude: 0, longitude: 179, altitude: 400 }, 4);

    expect(ring[0]!.latitude).toBeCloseTo(19.79, 2);
    expect(ring[0]!.longitude).toBeCloseTo(179, 6);
    expect(ring[1]!.longitude).toBeCloseTo(-161.21, 2);
    expect(ring[3]!.longitude).toBeCloseTo(159.21, 2);
  });
});
