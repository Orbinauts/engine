import { describe, expect, test } from "vitest";
import { groundTrack, groundTrackByDistance, isSunlit, orbitalPeriodSeconds, parseEphemeris, propagate, type Elements, type Sampling, type TrackPoint } from "./index.js";
import { ephemerisOracle, fixtureElements, fixtureEphemerisText, oracle, passOracle, positionDistanceKm, worstGapDegrees } from "../test/oracle.js";

const tolerance = oracle.tolerance.positionKm;

describe("groundTrack", () => {
  test.each(oracle.tracks)("$elements from $from agrees with Skyfield at every step", (expected) => {
    const elements = fixtureElements(expected.elements);
    const from = new Date(expected.from);
    const to = new Date(from.getTime() + (expected.points.length - 1) * expected.stepSeconds * 1000);

    const track = groundTrack(elements, { from, to, stepSeconds: expected.stepSeconds });

    expect(track.map((point) => point.at.toISOString())).toEqual(expected.points.map((point) => point.at));
    for (const [index, point] of track.entries()) {
      expect(positionDistanceKm(point, expected.points[index]!)).toBeLessThan(tolerance);
    }
  });

  test("stops at the last step that fits inside the window", () => {
    const elements = fixtureElements("iss-2026-09-19");
    const from = new Date("2026-09-19T15:00:00Z");

    const track = groundTrack(elements, { from, to: new Date("2026-09-19T15:02:30Z"), stepSeconds: 60 });

    expect(track.map((point) => point.at.toISOString())).toEqual([
      "2026-09-19T15:00:00.000Z",
      "2026-09-19T15:01:00.000Z",
      "2026-09-19T15:02:00.000Z",
    ]);
  });
});

/**
 * The same track sampled by ground distance rather than by clock. A
 * fixed step is a duration, and a duration is not a distance: over one
 * orbit an eccentric one spends as long at a perigee racing at 6.2 km/s as
 * at an apogee crawling at 0.8, so the sub-point is drawn coarsely at
 * exactly the place its path bends most. The oracle has nothing to say
 * about this: the Positions are the same ones `groundTrack` already agrees
 * with Skyfield on, and what is asserted here is which instants are asked
 * for.
 */

/** Every step between neighbouring points of a track, in seconds. */
const stepsSeconds = (track: readonly TrackPoint[]) =>
  track.slice(1).map((point, index) => (point.at.getTime() - track[index]!.at.getTime()) / 1000);

/** The shortest step between neighbouring points of a track, in seconds. */
const finestStepSeconds = (track: readonly TrackPoint[]) => Math.min(...stepsSeconds(track));

describe("groundTrackByDistance", () => {
  const CHANDRA = fixtureElements("chandra-2026-09-21");
  /** Chandra's own numbers for a map that draws one orbit: 63.48 hours over 240 steps, no finer than half a minute. */
  const CHANDRA_SAMPLING = { maxSeparationDegrees: 2, minStepSeconds: 30, maxStepSeconds: (63.479 * 3_600) / 240 };
  /**
   * The six hours around Chandra's perigee of 2026-09-21T13:49Z, 12,470 km
   * up: where the sub-point runs at about a degree a minute and a
   * fifteen-minute step draws a quarter of the way to the pole as one chord.
   */
  const AROUND_PERIGEE = { from: new Date("2026-09-21T10:49:00Z"), to: new Date("2026-09-21T16:49:00Z") };

  test("an eccentric orbit's perigee is drawn as finely as the bound asks, where a fixed step tears it", () => {
    const fixedStep = groundTrack(CHANDRA, { ...AROUND_PERIGEE, stepSeconds: CHANDRA_SAMPLING.maxStepSeconds });
    const byDistance = groundTrackByDistance(CHANDRA, { ...AROUND_PERIGEE, ...CHANDRA_SAMPLING });

    expect(worstGapDegrees(fixedStep)).toBeGreaterThan(10);
    expect(worstGapDegrees(byDistance)).toBeLessThanOrEqual(CHANDRA_SAMPLING.maxSeparationDegrees);
    // The step adapts rather than being chosen once: within the ceiling and
    // the floor it varies several-fold across one window, which is what the
    // fixed walk cannot do at either price. A step fine enough for this
    // window's perigee everywhere would have cost 900 points; this costs 118.
    const steps = stepsSeconds(byDistance);
    expect(Math.max(...steps)).toBeLessThanOrEqual(CHANDRA_SAMPLING.maxStepSeconds);
    expect(Math.min(...steps)).toBeGreaterThanOrEqual(CHANDRA_SAMPLING.minStepSeconds);
    expect(Math.min(...steps)).toBeLessThan(Math.max(...steps) / 4);
    expect(byDistance.length).toBeLessThan(fixedStep.length * 6);
  });

  test("the points are the Positions of the instants they carry, in order", () => {
    const track = groundTrackByDistance(CHANDRA, { ...AROUND_PERIGEE, ...CHANDRA_SAMPLING });

    for (const point of track) expect(point).toMatchObject({ at: point.at, ...propagate(CHANDRA, point.at) });
    for (const [index, point] of track.slice(1).entries()) expect(point.at.getTime()).toBeGreaterThan(track[index]!.at.getTime());
  });

  test("a bound no step can meet stops at the shortest step allowed rather than dividing for ever", () => {
    const track = groundTrackByDistance(CHANDRA, { ...AROUND_PERIGEE, ...CHANDRA_SAMPLING, maxSeparationDegrees: 0.000_1 });

    expect(finestStepSeconds(track)).toBeGreaterThanOrEqual(CHANDRA_SAMPLING.minStepSeconds);
    expect(worstGapDegrees(track)).toBeGreaterThan(0.000_1);
  });

  test("a track already inside the bound is the fixed-step track, with the window's own end on it", () => {
    const iss = fixtureElements("iss-2026-09-19");
    const window = { from: new Date("2026-09-20T12:00:00Z"), to: new Date("2026-09-20T13:32:57.900Z") };

    const track = groundTrackByDistance(iss, { ...window, maxSeparationDegrees: 2, minStepSeconds: 30, maxStepSeconds: 30 });

    // Nothing is divided, so the track is the grid: one step for every whole
    // one the ceiling allows over the window, each a shade under the ceiling
    // rather than at it, because the grid divides the window instead of being
    // laid from one end. That costs one point more than the fixed walk, whose
    // 186 steps of 30 seconds stop 27.9 short of the window they claim.
    const fixedStep = groundTrack(iss, { ...window, stepSeconds: 30 });
    expect(track).toHaveLength(fixedStep.length + 1);
    const steps = stepsSeconds(track);
    expect(Math.max(...steps)).toBeLessThanOrEqual(30);
    expect(Math.min(...steps)).toBeGreaterThan(29.98);
    expect(track[0]!.at).toEqual(window.from);
    expect(track.at(-1)!.at).toEqual(window.to);
  });

  test("both ends of the window are on the track, so a track ending now ends on the Satellite", () => {
    const track = groundTrackByDistance(CHANDRA, { ...AROUND_PERIGEE, ...CHANDRA_SAMPLING });

    // Six hours is 22.7 of Chandra's 952-second ceiling steps: stopping at the
    // last whole one left the line 10.8 degrees short of where the Satellite
    // was.
    expect(track[0]!.at).toEqual(AROUND_PERIGEE.from);
    expect(track.at(-1)!.at).toEqual(AROUND_PERIGEE.to);
  });
});

/**
 * Whether the Satellite is Sunlit at each point of the track, so a map can
 * draw the stretch in the Earth's shadow fainter. The oracle's own marks
 * are the culminations the Pass fixture holds for three low Satellites,
 * where Skyfield said whether
 * the Satellite was Sunlit. A map draws one line ending now and one
 * starting now, so each culmination is taken as the last point of an
 * orbit's track ending there and the first of one starting there: the two
 * points furthest from the middle of the window, where the line's one Sun
 * is taken, and so the two where that Sun is furthest off.
 */

/** A map's sampling for one orbit: at most 2 degrees between points, a step of half a minute at the finest and a 240th of the orbit at the coarsest. */
const mapSampling = (source: Elements) => ({
  maxSeparationDegrees: 2,
  minStepSeconds: 30,
  maxStepSeconds: Math.max(30, orbitalPeriodSeconds(source) / 240),
});

/** Every culmination the Pass fixture holds for the ISS, Tiangong and Hubble, with the Sunlit mark Skyfield gave it. */
const markedCulminations = passOracle.searches
  .filter((search) => /^(iss|tiangong|hubble)-/.test(search.elements))
  .flatMap((search) => search.passes.map(({ culmination }) => ({ elements: search.elements, at: culmination.at, sunlit: culmination.sunlit })));

describe("groundTrackByDistance marks each point Sunlit or not", () => {
  test("over culminations of all three Satellites in both states", () => {
    const states = new Map(["iss", "tiangong", "hubble"].map((name) => [name, new Set<boolean>()]));
    for (const { elements, sunlit } of markedCulminations) states.get(elements.split("-")[0]!)!.add(sunlit);

    // What the table below proves is only as good as what it holds: each Satellite in sunlight and in shadow.
    expect([...states.values()]).toEqual([new Set([true, false]), new Set([true, false]), new Set([true, false])]);
  });

  test.each(markedCulminations)("as Skyfield marked $elements at $at, at either end of an orbit's track", ({ elements, at, sunlit }) => {
    const source = fixtureElements(elements);
    const now = new Date(at);
    const periodMs = orbitalPeriodSeconds(source) * 1000;

    const ending = groundTrackByDistance(source, { from: new Date(now.getTime() - periodMs), to: now, ...mapSampling(source) });
    const starting = groundTrackByDistance(source, { from: now, to: new Date(now.getTime() + periodMs), ...mapSampling(source) });

    expect(ending.at(-1)).toMatchObject({ at: now, sunlit });
    expect(starting[0]).toMatchObject({ at: now, sunlit });
  });

  /**
   * One Sun for the whole line rather than one per point: the Sun moves a
   * few hundredths of a degree against the stars over an orbit, which
   * moves the crossings by under a second and no point's mark away from
   * the one `isSunlit` gives it with the Sun of its own instant — and `isSunlit` is the test the oracle checks
   * at every culmination above (sun.test.ts). Each orbit crosses the
   * shadow twice, so a line of one holds both states.
   */
  test.each(["iss-2026-09-19", "tiangong-2026-09-19", "hubble-2026-09-19"])("the one Sun a line of %s is marked against moves no point's mark over an orbit", (key) => {
    const source = fixtureElements(key);
    const from = new Date("2026-09-20T12:00:00Z");
    const track = groundTrackByDistance(source, { from, to: new Date(from.getTime() + orbitalPeriodSeconds(source) * 1000), ...mapSampling(source) });

    expect(track.map(({ at, sunlit }) => ({ at, sunlit }))).toEqual(track.map(({ at }) => ({ at, sunlit: isSunlit(source, at) })));
    expect(new Set(track.map(({ sunlit }) => sunlit))).toEqual(new Set([true, false]));
  });

  test("from an Ephemeris, against the Sun in its own frame", () => {
    const ephemeris = parseEphemeris(fixtureEphemerisText());
    const from = new Date(ephemerisOracle.covers.from);
    const sampling: Sampling = { from, to: new Date(from.getTime() + 93 * 60_000), maxSeparationDegrees: 2, minStepSeconds: 30, maxStepSeconds: 30 };

    const track = groundTrackByDistance(ephemeris, sampling);

    expect(track.map(({ at, sunlit }) => ({ at, sunlit }))).toEqual(track.map(({ at }) => ({ at, sunlit: isSunlit(ephemeris, at) })));
    expect(new Set(track.map(({ sunlit }) => sunlit))).toEqual(new Set([true, false]));
  });
});
