import { describe, expect, test } from "vitest";
import inViewFixture from "../fixtures/in-view.json" with { type: "json" };
import { footprint, IN_VIEW_MIN_ELEVATION, isInView, lookAngles, propagate, readElements, type Observer, type Position } from "./index.js";
import { fixtureElements } from "../test/oracle.js";

/**
 * In view is what a receiver answers: the Satellite is above the Observer's
 * horizon at this instant, whatever the light. The oracle
 * scenes below are the proof — Skyfield's own topocentric elevations for a
 * fixed set of GPS and Galileo satellites over fixed Observers at fixed
 * instants — since the engine reaches the same answer by another road, from
 * the point beneath the Satellite and its altitude rather than from the
 * Satellite's own vector. Each scene lists its Satellites under
 * `satellites`; the fixture is kept as generated.
 */

const madrid: Observer = { latitude: 40.4168, longitude: -3.7038, altitude: 657 };

describe.each(inViewFixture.scenes)("In view over $key", (scene) => {
  const positions = scene.satellites.map((satellite) => propagate(fixtureElements(satellite.elements), new Date(scene.at)));

  test("says of every Satellite what Skyfield says", () => {
    expect(positions.map((position) => isInView(position, scene.observer))).toEqual(scene.satellites.map((satellite) => satellite.inView));
  });

  test("counts the Satellites a receiver here would have", () => {
    expect(positions.filter((position) => isInView(position, scene.observer)).length).toBe(scene.inView);
  });

  test("the oracle's own elevations bear the flags out, every one clear of the horizon", () => {
    for (const satellite of scene.satellites) {
      expect(satellite.inView, satellite.elements).toBe(satellite.elevation >= 0);
      expect(Math.abs(satellite.elevation), satellite.elements).toBeGreaterThanOrEqual(inViewFixture.edgeMarginDegrees);
    }
  });
});

/**
 * The look angles: how high and in which direction, over the same horizon
 * `isInView` decides by. When a Satellite next crosses that horizon is a
 * Pass, which the Pass search works out from a Source, so the look angles
 * answer no crossing.
 *
 * The elevation is held to Skyfield's own, to a thousandth of a degree:
 * the engine reaches it from the point beneath the Satellite and its
 * altitude, where Skyfield takes the Satellite's own vector, and the two
 * agree that closely over every scene the oracle wrote.
 */
const ORACLE_ELEVATION_TOLERANCE_DEGREES = 0.001;

describe.each(inViewFixture.scenes)("the look angles over $key", (scene) => {
  const at = new Date(scene.at);
  const looks = scene.satellites.map((satellite) => lookAngles(propagate(fixtureElements(satellite.elements), at), scene.observer));

  test("say what Skyfield says, to a thousandth of a degree", () => {
    for (const [index, satellite] of scene.satellites.entries()) {
      const look = looks[index]!;
      expect(look.elevation >= 0, satellite.elements).toBe(satellite.inView);
      expect(look.elevation, satellite.elements).toBeCloseTo(satellite.elevation, 3);
      expect(Math.abs(look.elevation - satellite.elevation), satellite.elements).toBeLessThan(ORACLE_ELEVATION_TOLERANCE_DEGREES);
    }
  });

  test("point somewhere on the compass, whichever side of the horizon the Satellite is", () => {
    for (const [index, satellite] of scene.satellites.entries()) {
      expect(looks[index]!.azimuth, satellite.elements).toBeGreaterThanOrEqual(0);
      expect(looks[index]!.azimuth, satellite.elements).toBeLessThan(360);
    }
  });
});

test("the two Observers on opposite sides of the Earth see opposite Satellites at the one instant", () => {
  const [madridScene, wellingtonScene] = inViewFixture.scenes;

  expect(wellingtonScene!.at).toBe(madridScene!.at);
  for (const [index, satellite] of madridScene!.satellites.entries()) {
    expect(wellingtonScene!.satellites[index]!.inView, satellite.elements).toBe(!satellite.inView);
  }
});

test("a Geostationary Satellite stands where it stands: high in one sky and under the far side of the Earth from another", () => {
  const goes19 = propagate(fixtureElements("goes-19-2026-09-19"), new Date("2026-09-19T18:00:00Z"));
  // GOES-19 stands over 75.2 degrees west: high in Brasilia's north-western sky and under the far side of the Earth from Tokyo, and neither is going to change.
  const brasilia: Observer = { latitude: -15.8, longitude: -47.9, altitude: 1_100 };
  const tokyo: Observer = { latitude: 35.7, longitude: 139.7, altitude: 40 };

  expect(lookAngles(goes19, brasilia)).toEqual({ elevation: expect.closeTo(53.6, 1), azimuth: expect.closeTo(297.8, 1) });
  expect(lookAngles(goes19, tokyo)).toEqual({ elevation: expect.closeTo(-47.6, 1), azimuth: expect.closeTo(50.0, 1) });
});

describe("the geometry of the horizon", () => {
  const overhead = (altitude: number): Position => ({ latitude: madrid.latitude, longitude: madrid.longitude, altitude });

  test("a Satellite straight overhead is in view, however low", () => {
    expect(isInView(overhead(400), madrid)).toBe(true);
    expect(isInView(overhead(1), madrid)).toBe(true);
  });

  test("the threshold is the caller's: the horizon at 0 degrees unless another elevation is asked for", () => {
    const north: Position = { latitude: madrid.latitude + 10, longitude: madrid.longitude, altitude: 400 };
    const { elevation } = lookAngles(north, madrid);

    expect(IN_VIEW_MIN_ELEVATION).toBe(0);
    expect(elevation).toBeGreaterThan(0);
    expect(elevation).toBeLessThan(30);
    expect(isInView(north, madrid)).toBe(true);
    expect(isInView(north, madrid, {})).toBe(true);
    expect(isInView(north, madrid, { minElevation: undefined })).toBe(true);
    expect(isInView(north, madrid, { minElevation: IN_VIEW_MIN_ELEVATION })).toBe(true);
    expect(isInView(north, madrid, { minElevation: elevation - 0.01 })).toBe(true);
    expect(isInView(north, madrid, { minElevation: elevation + 0.01 })).toBe(false);
    expect(isInView(overhead(400), madrid, { minElevation: 89 })).toBe(true);
  });

  test("a Satellite over the far side of the Earth is not", () => {
    expect(isInView({ latitude: -madrid.latitude, longitude: madrid.longitude + 180, altitude: 400 }, madrid)).toBe(false);
  });

  test("the Observer's horizon is the edge of the Satellite's Footprint: inside it the Satellite is up, outside it is not", () => {
    // The ring of ground points from which a Satellite at this altitude sits
    // exactly on the horizon grows with the altitude, so the Footprint of a
    // lower Satellite over the same point is a ring strictly inside this one's
    // and that of a higher Satellite strictly outside it. Every point of the
    // inner ring must see the real Satellite and no point of the outer one may:
    // reading both boundaries off `footprint` rather than off an Earth
    // radius of this test's own is what makes the two answers one claim.
    //
    // The two rings are about 90 km either side of the real horizon, which
    // clears the few kilometres by which they can disagree at all —
    // `footprint` draws on a sphere where these look angles are taken on the
    // ellipsoid.
    const satellite: Position = { latitude: 20, longitude: -10, altitude: 20_180 };
    const ringAt = (altitude: number) => footprint({ ...satellite, altitude }, 24).map((point) => ({ ...point, altitude: 0 }));

    expect(ringAt(19_000).filter((observer) => !isInView(satellite, observer))).toEqual([]);
    expect(ringAt(21_500).filter((observer) => isInView(satellite, observer))).toEqual([]);
  });
});
