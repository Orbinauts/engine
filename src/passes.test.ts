import { describe, expect, test } from "vitest";
import {
  findPasses,
  findVisiblePasses,
  longestPassSeconds,
  NIGHT_SUN_ALTITUDE,
  nightsOver,
  sunAltitude,
  VISIBLE_FAINTEST_MAGNITUDE,
  VISIBLE_MIN_ELEVATION,
  VISIBLE_RULE,
  type Pass,
} from "./index.js";
import { expectPassToAgree, fixtureElements, passOracle, searchMagnitude, secondsApart, statedMagnitude } from "../test/oracle.js";

const tolerance = passOracle.tolerance;

/** How long a Pass lasts, from rise to set, in hours. */
const hoursOf = (pass: { rise: { at: string }; set: { at: string } }) =>
  (new Date(pass.set.at).getTime() - new Date(pass.rise.at).getTime()) / 3_600_000;

describe.each(passOracle.searches)("findPasses over $key", (search) => {
  const elements = fixtureElements(search.elements);
  const interval = { from: new Date(search.from), to: new Date(search.to) };
  const passes = findPasses(elements, search.observer, interval, searchMagnitude(search));

  test("finds the Passes Skyfield finds, in order", () => {
    expect(passes.map((pass) => pass.rise.at.toISOString().slice(0, 16))).toEqual(
      search.passes.map((pass) => pass.rise.at.slice(0, 16)),
    );
  });

  test.each(search.passes.map((expected, index) => [expected.rise.at, index, expected] as const))(
    "the Pass rising at %s agrees with Skyfield within the tolerances",
    (_, index, expected) => {
      expectPassToAgree(passes[index]!, expected);
    },
  );
});

describe("the Visible pass rule", () => {
  const madrid = passOracle.searches[0]!;
  // The subject here is what the rule makes of a magnitude, so this search
  // has to be one that states one.
  const madridMagnitude = statedMagnitude(madrid);
  const elements = fixtureElements(madrid.elements);
  const interval = { from: new Date(madrid.from), to: new Date(madrid.to) };
  const passesOf = (standardMagnitude: number) => findPasses(elements, madrid.observer, interval, standardMagnitude);

  test("the three numbers of the rule are the ones the Skyfield oracle proves", () => {
    expect(NIGHT_SUN_ALTITUDE).toBe(-6);
    expect(VISIBLE_MIN_ELEVATION).toBe(10);
    expect(VISIBLE_FAINTEST_MAGNITUDE).toBe(4);
    expect(NIGHT_SUN_ALTITUDE).toBe(passOracle.visiblePass.maxSunAltitude);
    expect(VISIBLE_MIN_ELEVATION).toBe(passOracle.visiblePass.minElevation);
    expect(VISIBLE_FAINTEST_MAGNITUDE).toBe(passOracle.visiblePass.faintestMagnitude);
  });

  test("a Pass is Visible exactly when it has a window", () => {
    const passes = passOracle.searches.flatMap((search) =>
      findPasses(fixtureElements(search.elements), search.observer, { from: new Date(search.from), to: new Date(search.to) }, searchMagnitude(search)),
    );

    expect(passes.every((pass) => pass.visible === (pass.window !== null))).toBe(true);
  });

  test("inside a window the Satellite is at least 10 degrees up and no fainter than the threshold", () => {
    for (const window of passesOf(madridMagnitude).flatMap((pass) => (pass.window === null ? [] : [pass.window]))) {
      expect(window.appears.elevation).toBeGreaterThanOrEqual(VISIBLE_MIN_ELEVATION - tolerance.elevationDegrees);
      expect(window.disappears.elevation).toBeGreaterThanOrEqual(VISIBLE_MIN_ELEVATION - tolerance.elevationDegrees);
      expect(window.appears.at.getTime()).toBeLessThan(window.disappears.at.getTime());
      expect(window.peak.at.getTime()).toBeGreaterThanOrEqual(window.appears.at.getTime());
      expect(window.peak.at.getTime()).toBeLessThanOrEqual(window.disappears.at.getTime());
      expect(window.peak.magnitude).toBeLessThanOrEqual(VISIBLE_FAINTEST_MAGNITUDE);
    }
  });

  test("the Standard magnitude is an input: too faint a Satellite has no Visible pass over the same Observer", () => {
    expect(passesOf(madridMagnitude).some((pass) => pass.visible)).toBe(true);
    expect(passesOf(VISIBLE_FAINTEST_MAGNITUDE + 10).some((pass) => pass.visible)).toBe(false);
  });

  test("a Satellite the field has published no Standard magnitude for keeps its Passes and can have no Visible one", () => {
    const withMagnitude = passesOf(madridMagnitude);
    const withNone = findPasses(elements, madrid.observer, interval, undefined);

    expect(withNone.map((pass) => pass.rise.at)).toEqual(withMagnitude.map((pass) => pass.rise.at));
    expect(withNone.every((pass) => pass.culmination.magnitude === null)).toBe(true);
    expect(withNone.every((pass) => pass.window === null)).toBe(true);
    expect(withNone.every((pass) => pass.visible === false)).toBe(true);
    // Everything the geometry alone knows is answered as it always was.
    expect(withNone.map((pass) => pass.culmination.sunlit)).toEqual(withMagnitude.map((pass) => pass.culmination.sunlit));
    expect(withNone.map((pass) => pass.culmination.elevation)).toEqual(withMagnitude.map((pass) => pass.culmination.elevation));
  });

  test("the same Passes are found whatever the Standard magnitude; only their windows differ", () => {
    const bright = passesOf(madridMagnitude);
    const faint = passesOf(VISIBLE_FAINTEST_MAGNITUDE + 10);

    expect(faint.map((pass) => pass.rise.at)).toEqual(bright.map((pass) => pass.rise.at));
    expect(faint.every((pass) => pass.window === null)).toBe(true);
  });
});

describe("the thresholds of the Visible pass rule are the caller's, the three numbers above when none is given", () => {
  const madrid = passOracle.searches.find((candidate) => candidate.key === "madrid-3-days")!;
  const madridMagnitude = statedMagnitude(madrid);
  const elements = fixtureElements(madrid.elements);
  const interval = { from: new Date(madrid.from), to: new Date(madrid.to) };
  const windowsOf = (passes: Pass[]) => passes.flatMap((pass) => (pass.window === null ? [] : [pass.window]));

  test("the defaults are the three numbers of the rule", () => {
    expect(VISIBLE_RULE).toEqual({
      minElevation: VISIBLE_MIN_ELEVATION,
      faintestMagnitude: VISIBLE_FAINTEST_MAGNITUDE,
      nightSunAltitude: NIGHT_SUN_ALTITUDE,
    });
  });

  test("passing the defaults explicitly finds the very Passes passing nothing finds", () => {
    const implicit = findPasses(elements, madrid.observer, interval, madridMagnitude);

    expect(findPasses(elements, madrid.observer, interval, madridMagnitude, VISIBLE_RULE)).toEqual(implicit);
    expect(findVisiblePasses(elements, madrid.observer, interval, madridMagnitude, VISIBLE_RULE)).toEqual(implicit.filter((pass) => pass.visible));
    expect(nightsOver(madrid.observer, interval, VISIBLE_RULE)).toEqual(nightsOver(madrid.observer, interval));
  });

  test("a threshold set to undefined is the default, as if left out", () => {
    const unset = { minElevation: undefined, faintestMagnitude: undefined, nightSunAltitude: undefined };

    expect(findPasses(elements, madrid.observer, interval, madridMagnitude, unset)).toEqual(findPasses(elements, madrid.observer, interval, madridMagnitude));
    expect(findVisiblePasses(elements, madrid.observer, interval, madridMagnitude, unset)).toEqual(findVisiblePasses(elements, madrid.observer, interval, madridMagnitude));
  });

  test("a higher minimum elevation opens each window higher, and none on a Pass that never reaches it", () => {
    const minElevation = 20;
    const passes = findPasses(elements, madrid.observer, interval, madridMagnitude, { minElevation });

    expect(windowsOf(passes).length).toBeGreaterThan(0);
    for (const window of windowsOf(passes)) {
      expect(window.appears.elevation).toBeGreaterThanOrEqual(minElevation - tolerance.elevationDegrees);
      expect(window.disappears.elevation).toBeGreaterThanOrEqual(minElevation - tolerance.elevationDegrees);
    }
    expect(passes.filter((pass) => pass.culmination.elevation < minElevation).every((pass) => pass.window === null)).toBe(true);
    expect(passes.filter((pass) => pass.visible).length).toBeLessThan(findPasses(elements, madrid.observer, interval, madridMagnitude).filter((pass) => pass.visible).length);
  });

  test("a fainter limit lets a Satellite too faint for the default have Visible passes", () => {
    const faint = VISIBLE_FAINTEST_MAGNITUDE + 10;

    expect(findPasses(elements, madrid.observer, interval, faint).some((pass) => pass.visible)).toBe(false);
    const passes = findPasses(elements, madrid.observer, interval, faint, { faintestMagnitude: faint + 10 });
    expect(passes.some((pass) => pass.visible)).toBe(true);
    for (const window of windowsOf(passes)) expect(window.peak.magnitude).toBeLessThanOrEqual(faint + 10);
  });

  test("a darker Night, astronomical at 18 degrees, is shorter and holds every window", () => {
    const nightSunAltitude = -18;
    const dark = nightsOver(madrid.observer, interval, { nightSunAltitude });
    const nautical = nightsOver(madrid.observer, interval);

    expect(dark).toHaveLength(nautical.length);
    for (const [index, night] of dark.entries()) {
      expect(night.from.getTime()).toBeGreaterThan(nautical[index]!.from.getTime());
      expect(night.to.getTime()).toBeLessThan(nautical[index]!.to.getTime());
    }
    const passes = findPasses(elements, madrid.observer, interval, madridMagnitude, { nightSunAltitude });
    for (const window of windowsOf(passes)) {
      expect(sunAltitude(madrid.observer, window.appears.at)).toBeLessThan(nightSunAltitude + 0.1);
      expect(sunAltitude(madrid.observer, window.disappears.at)).toBeLessThan(nightSunAltitude + 0.1);
    }
    expect(findVisiblePasses(elements, madrid.observer, interval, madridMagnitude, { nightSunAltitude })).toEqual(passes.filter((pass) => pass.visible));
  });
});

/**
 * The window search is the expensive half of a Pass search, and for most
 * Satellites it can only ever answer "none". The search decides that from the
 * orbit before it walks a single Pass: at the closest the orbit brings the
 * Satellite to the ground, with its whole lit face turned that way, the model
 * still cannot reach the threshold.
 */
describe("a Visible window ruled out by the orbit is never searched for", () => {
  const bangkok = passOracle.searches.find((search) => search.key === "bangkok-hubble-3-days")!;
  const elements = fixtureElements(bangkok.elements);
  const interval = { from: new Date(bangkok.from), to: new Date(bangkok.to) };
  const passesOf = (standardMagnitude: number | undefined) => findPasses(elements, bangkok.observer, interval, standardMagnitude);

  test("Hubble's own magnitude reaches the threshold from its orbit, so its windows are searched for and found", () => {
    expect(passesOf(statedMagnitude(bangkok)).some((pass) => pass.visible)).toBe(true);
  });

  test("the same orbit too faint to reach it from anywhere finds the same Passes, with no window on any of them", () => {
    const bright = passesOf(statedMagnitude(bangkok));
    // Ten magnitudes fainter cannot reach the threshold at this orbit's perigee, whatever the geometry.
    const faint = passesOf(statedMagnitude(bangkok) + 10);

    expect(faint.map((pass) => pass.rise.at)).toEqual(bright.map((pass) => pass.rise.at));
    expect(faint.map((pass) => pass.culmination.elevation)).toEqual(bright.map((pass) => pass.culmination.elevation));
    expect(faint.every((pass) => pass.window === null)).toBe(true);
    // The brightness is still reported: only the window is ruled out, never the arithmetic.
    expect(faint.every((pass) => pass.culmination.magnitude !== null)).toBe(true);
  });

  test("a Satellite with no Standard magnitude cannot reach it either, and keeps every Pass", () => {
    expect(passesOf(undefined).map((pass) => pass.rise.at)).toEqual(passesOf(statedMagnitude(bangkok)).map((pass) => pass.rise.at));
    expect(passesOf(undefined).every((pass) => pass.window === null)).toBe(true);
  });
});

describe("the fixtures cover every scenario the Pass search could go wrong in", () => {
  const passes = passOracle.searches.flatMap((search) => search.passes.map((pass) => ({ search, pass })));
  const elementsOf = (search: { elements: string }) =>
    (passOracle.elements as Record<string, { NORAD_CAT_ID: number; MEAN_MOTION: number }>)[search.elements]!;
  const catalogueNumberOf = (search: { elements: string }) => elementsOf(search).NORAD_CAT_ID;
  /** How long one turn of the search's orbit takes, from the mean motion the fixture records. */
  const hoursPerOrbit = (search: { elements: string }) => 24 / elementsOf(search).MEAN_MOTION;
  const { maxSunAltitude, minElevation } = passOracle.visiblePass;

  test.each([
    ["a normal night Visible pass", ({ pass }) => pass.visible && pass.culmination.sunAltitude < -12],
    ["a daylight pass", ({ pass }) => pass.culmination.sunAltitude > 0 && pass.culmination.elevation >= minElevation],
    ["a horizon-hugging pass below 10 degrees", ({ pass }) => pass.culmination.elevation < minElevation],
    ["a pass in Earth's shadow at night", ({ pass }) => !pass.culmination.sunlit && pass.culmination.sunAltitude < maxSunAltitude],
    [
      "a high-latitude summer twilight Visible pass",
      ({ search, pass }) => Math.abs(search.observer.latitude) >= 55 && pass.culmination.sunAltitude > -12 && pass.visible,
    ],
    ["an Observer at altitude", ({ search }) => search.observer.altitude >= 1000],
    [
      "a window that ends mid-sky in the Earth's shadow",
      ({ pass }) => pass.window !== null && pass.window.disappears.reason === "sunlit" && pass.window.disappears.elevation >= 20,
    ],
    ["a window that ends before culmination", ({ pass }) => pass.window !== null && pass.window.disappears.at < pass.culmination.at],
    [
      "a Hubble Pass excluded by brightness alone",
      ({ search, pass }) => !pass.visible && pass.geometryPeakMagnitude !== null && catalogueNumberOf(search) === 20580,
    ],
    ["a Pass with two candidate intervals", ({ pass }) => pass.candidateIntervals >= 2],
    ["a Pass lasting over ten hours, which only a deep-space orbit gives", ({ pass }) => hoursOf(pass) > 10],
    [
      "a Chandra Pass too far away to be Visible at any brightness",
      ({ search, pass }) => !pass.visible && pass.geometryPeakMagnitude !== null && catalogueNumberOf(search) === 25867,
    ],
    // A Satellite of a Constellation: a navigation orbit, whose Passes are
    // hours long, and a Satellite the field has published no Standard
    // magnitude for, so its Pass carries no brightness at all rather than
    // one too faint to see: nothing here estimates a missing magnitude.
    ["a Pass on a 12-hour navigation orbit", ({ search }) => Math.abs(hoursPerOrbit(search) - 12) < 0.1],
    ["a Pass of a Satellite with no Standard magnitude, which carries none", ({ search, pass }) => search.standardMagnitude === null && pass.culmination.magnitude === null],
  ] satisfies [string, (entry: (typeof passes)[number]) => boolean][])("%s", (_, matches) => {
    expect(passes.some(matches)).toBe(true);
  });

  test.each([
    ["the ISS", 25544],
    ["Tiangong", 48274],
    ["Hubble", 20580],
  ])("a Visible pass of %s", (_, catalogueNumber) => {
    expect(passes.some(({ search, pass }) => pass.visible && catalogueNumberOf(search) === catalogueNumber)).toBe(true);
  });

  test.each(["elevation", "sunlit", "night", "brightness"])("a window that begins or ends because of %s", (reason) => {
    expect(passes.some(({ pass }) => pass.window !== null && [pass.window.appears.reason, pass.window.disappears.reason].includes(reason))).toBe(
      true,
    );
  });
});

describe("findPasses reports every Pass that overlaps the interval in full", () => {
  const search = passOracle.searches[0]!;
  const standardMagnitude = statedMagnitude(search);
  const elements = fixtureElements(search.elements);
  const first = search.passes[1]!;
  const rise = new Date(first.rise.at);
  const set = new Date(first.set.at);

  test("a Pass in progress at the start is reported from its rise", () => {
    const passes = findPasses(
      elements,
      search.observer,
      { from: new Date(rise.getTime() + 60_000), to: new Date(search.to) },
      standardMagnitude,
    );

    expect(secondsApart(passes[0]!.rise.at, first.rise.at)).toBeLessThan(tolerance.timeSeconds);
    expect(passes).toHaveLength(search.passes.length - 1);
  });

  test("a Pass still in progress at the end is reported to its set", () => {
    const passes = findPasses(
      elements,
      search.observer,
      { from: new Date(search.from), to: new Date(rise.getTime() + 60_000) },
      standardMagnitude,
    );

    expect(passes).toHaveLength(2);
    expect(secondsApart(passes[1]!.set.at, first.set.at)).toBeLessThan(tolerance.timeSeconds);
  });

  test("an interval between two Passes has none", () => {
    const passes = findPasses(
      elements,
      search.observer,
      { from: new Date(set.getTime() + 60_000), to: new Date(new Date(search.passes[2]!.rise.at).getTime() - 60_000) },
      standardMagnitude,
    );

    expect(passes).toEqual([]);
  });
});

/**
 * The search's two bounds on an orbit far outside low Earth orbit, where
 * everything the ISS taught the search is out by two orders of magnitude:
 * Chandra takes 63.5 hours to run from a perigee of 12,000 km to an apogee
 * of 137,000 km, and each of its Passes lasts half a day. Both bounds are
 * derived from the orbit rather than tuned to low Earth orbit, and these
 * are the fixtures that hold them to it.
 *
 * The step bound is proved above rather than here, and by the only thing
 * that can prove it: `findPasses over $key` finds every Pass Skyfield finds
 * over the Chandra search and no others. A step too coarse for an orbit
 * this slow would stride over a horizon crossing and lose a Pass, so an
 * agreeing count is the assertion. What is left to say here is the bound on
 * how long a Pass may last, and what the strides cost.
 */
describe("the search's bounds, and what it costs to honour them, hold for every orbit the fixtures cover", () => {
  const searches = passOracle.searches.map((search) => [search.key, search] as const);

  test.each(searches)("%s: the longest-Pass bound is a number, and longer than every Pass Skyfield found there", (_, search) => {
    const longest = Math.max(...search.passes.map(hoursOf)) * 3600;
    const bound = longestPassSeconds(fixtureElements(search.elements));

    // A number first: the ground rate the bound divides by was the root of
    // a negative quantity for every orbit that turns slower than twice the
    // Earth does, which is every orbit above low Earth orbit, and nothing
    // asked for one until these fixtures did. How close the bound sits to
    // the longest Pass is asserted where it is used, on the Ephemeris a Pass
    // search's interval is padded with it for (`ephemeris.test.ts`).
    expect(Number.isFinite(bound)).toBe(true);
    expect(bound).toBeGreaterThan(longest);
  });

  // What these numbers are for is a serverless function's CPU budget, which
  // may be as little as a second: a search that overran it would be cut off
  // with no answer, which is what happened to Chandra's before its window
  // search was ruled out ahead of time. A Pass is scanned for its window at a fixed
  // ten-second step, so that half of the work costs what the Pass is long —
  // half a day for Chandra against ten minutes for the ISS — and an orbit
  // that can hold no window at all now skips it.
  test.each([
    ["madrid-3-days", 40, 100],
    ["nairobi-chandra-3-days", 5, 100],
  ])("a 10-day search over %s finds over %d Passes in under %d ms of CPU", (key, leastPasses, milliseconds) => {
    const search = passOracle.searches.find((candidate) => candidate.key === key)!;
    const elements = fixtureElements(search.elements);
    const from = new Date(search.from);
    const to = new Date(from.getTime() + 10 * 86_400_000);
    findPasses(elements, search.observer, { from, to }, searchMagnitude(search));

    const started = Date.now();
    const passes = findPasses(elements, search.observer, { from, to }, searchMagnitude(search));
    const elapsed = Date.now() - started;

    expect(passes.length).toBeGreaterThan(leastPasses);
    expect(elapsed).toBeLessThan(milliseconds);
  });
});

/**
 * The search of the Observer's Nights alone (`findVisiblePasses`), which the
 * API runs for a question about Visible passes only, against the search of
 * the whole interval it stands in for: the same Passes to the bit, not
 * within a tolerance, over every search the fixtures hold and over the
 * intervals most likely to split them.
 */
describe("findVisiblePasses finds exactly the Visible passes findPasses finds, searching only the Nights", () => {
  const visibleOf = (passes: Pass[]) => passes.filter((pass) => pass.visible);

  test.each(passOracle.searches.map((search) => [search.key, search] as const))("over %s", (_, search) => {
    const elements = fixtureElements(search.elements);
    const interval = { from: new Date(search.from), to: new Date(search.to) };

    expect(findVisiblePasses(elements, search.observer, interval, searchMagnitude(search))).toEqual(
      visibleOf(findPasses(elements, search.observer, interval, searchMagnitude(search))),
    );
  });

  test("over ten days of the ISS over Madrid, with the Nights worked out once and handed over", () => {
    const search = passOracle.searches.find((candidate) => candidate.key === "madrid-3-days")!;
    const elements = fixtureElements(search.elements);
    const from = new Date(search.from);
    const interval = { from, to: new Date(from.getTime() + 10 * 86_400_000) };
    const nights = nightsOver(search.observer, interval);
    const full = visibleOf(findPasses(elements, search.observer, interval, searchMagnitude(search)));

    expect(nights).toHaveLength(10);
    expect(full.length).toBeGreaterThan(5);
    expect(findVisiblePasses(elements, search.observer, interval, searchMagnitude(search), { nights })).toEqual(full);
  });

  // A Visible pass whose Night lies wholly outside the interval: its window
  // closes at dawn before the interval opens, or opens at dusk after it
  // closes, while the Pass itself is still above the horizon. No Night of
  // the interval holds it; only the search of the interval's ends does.
  const edges = passOracle.searches.flatMap((search) => {
    const elements = fixtureElements(search.elements);
    const interval = { from: new Date(search.from), to: new Date(search.to) };
    return visibleOf(findPasses(elements, search.observer, interval, searchMagnitude(search))).map((pass) => ({ search, elements, pass }));
  });
  const dawn = edges.find(({ pass }) => pass.window!.disappears.reason === "night" && pass.set.at > pass.window!.disappears.at);
  const dusk = edges.find(({ pass }) => pass.window!.appears.reason === "night" && pass.rise.at < pass.window!.appears.at);

  test.each([
    [
      "one whose window closed at dawn, still up as the interval opens",
      dawn,
      (pass: Pass) => ({ from: new Date(pass.window!.disappears.at.getTime() + 2_000), to: new Date(pass.set.at.getTime() + 86_400_000) }),
    ],
    [
      "one whose window opens at dusk, already up as the interval closes",
      dusk,
      (pass: Pass) => ({ from: new Date(pass.rise.at.getTime() - 86_400_000), to: new Date(pass.window!.appears.at.getTime() - 2_000) }),
    ],
  ] as const)("and %s", (_, found, intervalAround) => {
    expect(found).toBeDefined();
    const { search, elements, pass } = found!;
    const interval = intervalAround(pass);
    const full = visibleOf(findPasses(elements, search.observer, interval, searchMagnitude(search)));

    expect(full).toContainEqual(pass);
    expect(findVisiblePasses(elements, search.observer, interval, searchMagnitude(search))).toEqual(full);
  });

  test("and none where the Sun never sets 6 degrees, as at 70 degrees north in midsummer, where the whole interval's search finds none either", () => {
    const search = passOracle.searches.find((candidate) => candidate.key === "edinburgh-summer-3-days")!;
    const elements = fixtureElements(search.elements);
    const observer = { latitude: 70, longitude: search.observer.longitude, altitude: 0 };
    const interval = { from: new Date(search.from), to: new Date(search.to) };

    expect(nightsOver(observer, interval)).toEqual([]);
    expect(findVisiblePasses(elements, observer, interval, searchMagnitude(search))).toEqual([]);
    expect(visibleOf(findPasses(elements, observer, interval, searchMagnitude(search)))).toEqual([]);
  });
});

describe("nightsOver", () => {
  const madrid = passOracle.searches.find((candidate) => candidate.key === "madrid-3-days")!.observer;

  test.each([
    ["Madrid in September", madrid, "2026-09-03T14:00:00Z", 3],
    ["Edinburgh at midsummer, with a short Night", { latitude: 55.9533, longitude: -3.1883, altitude: 47 }, "2026-06-28T12:00:00Z", 3],
    ["La Paz, high in the tropics", { latitude: -16.4897, longitude: -68.1193, altitude: 3640 }, "2026-09-04T00:00:00Z", 2],
  ])("over %s holds every minute of Night and no minute of daylight or Twilight", (_, observer, from, days) => {
    const interval = { from: new Date(from), to: new Date(new Date(from).getTime() + days * 86_400_000) };
    const nights = nightsOver(observer, interval);
    const inNight = (t: number) => nights.some((night) => night.from.getTime() <= t && t <= night.to.getTime());

    expect(nights.length).toBeGreaterThanOrEqual(days - 1);
    for (let t = interval.from.getTime(); t <= interval.to.getTime(); t += 60_000) {
      expect(inNight(t), new Date(t).toISOString()).toBe(sunAltitude(observer, new Date(t)) < NIGHT_SUN_ALTITUDE);
    }
    // In order, apart, and inside the interval.
    for (const [index, night] of nights.entries()) {
      expect(night.from.getTime()).toBeGreaterThanOrEqual(interval.from.getTime());
      expect(night.to.getTime()).toBeLessThanOrEqual(interval.to.getTime());
      expect(night.from.getTime()).toBeLessThan(night.to.getTime());
      if (index > 0) expect(night.from.getTime()).toBeGreaterThan(nights[index - 1]!.to.getTime());
    }
  });

  test("is the whole interval where the Sun never rises 6 degrees, as at 78 degrees north in midwinter", () => {
    const interval = { from: new Date("2026-12-20T00:00:00Z"), to: new Date("2026-12-23T00:00:00Z") };

    expect(nightsOver({ latitude: 78, longitude: 15, altitude: 0 }, interval)).toEqual([interval]);
  });
});
