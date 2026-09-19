import { describe, expect, test } from "vitest";
import {
  ephemerisCovers,
  ephemerisInterval,
  EphemerisError,
  findPasses,
  groundTrack,
  interpolate,
  longestPassSeconds,
  parseEphemeris,
  orbitalSpeed,
  positionAt,
  propagate,
  PropagationError,
  speedAt,
} from "./index.js";
import {
  ephemerisOracle,
  expectPassToAgree,
  fixtureElements,
  fixtureEphemerisText,
  passOracle,
  positionDistanceKm,
  secondsApart,
  statedMagnitude,
} from "../test/oracle.js";

const tolerance = ephemerisOracle.tolerance.positionKm;
const ephemeris = parseEphemeris(fixtureEphemerisText());

describe("parseEphemeris reads the format NASA publishes", () => {
  test("the issue time, the vectors in time order and the window they cover", () => {
    expect(ephemeris.issuedAt.toISOString()).toBe(ephemerisOracle.issuedAt);
    expect(ephemeris.vectors).toHaveLength(ephemerisOracle.vectors);
    expect(ephemeris.vectors[0]!.at.toISOString()).toBe(ephemerisOracle.covers.from);
    expect(ephemeris.vectors.at(-1)!.at.toISOString()).toBe(ephemerisOracle.covers.to);
  });
});

describe("interpolate", () => {
  test.each(ephemerisOracle.positions)("at $at agrees with Skyfield within the tolerance", (expected) => {
    const position = interpolate(ephemeris, new Date(expected.at));

    expect(positionDistanceKm(position, expected)).toBeLessThan(tolerance);
  });

  test("follows the Ephemeris, not the Elements, after the reboost", () => {
    const elements = fixtureElements(ephemerisOracle.elements);
    const afterReboost = ephemerisOracle.positions.filter((expected) => expected.afterReboost);
    expect(afterReboost.length).toBeGreaterThan(0);

    for (const expected of afterReboost) {
      const at = new Date(expected.at);
      expect(expected.divergenceKm).toBeGreaterThan(ephemerisOracle.tolerance.minDivergenceKm);
      expect(positionDistanceKm(propagate(elements, at), expected)).toBeGreaterThan(ephemerisOracle.tolerance.minDivergenceKm);
      expect(positionDistanceKm(interpolate(ephemeris, at), expected)).toBeLessThan(tolerance);
    }
  });
});

describe("speedAt", () => {
  const speedOf = ({ velocity }: { velocity: { x: number; y: number; z: number } }) => Math.hypot(velocity.x, velocity.y, velocity.z);

  test("at a vector's own instant the speed is that vector's", () => {
    for (const vector of [ephemeris.vectors[0]!, ephemeris.vectors[300]!, ephemeris.vectors.at(-1)!]) {
      expect(speedAt(ephemeris, vector.at)).toBeCloseTo(speedOf(vector), 9);
    }
  });

  test("halfway between two vectors the speed is within 10 m/s of both neighbours", () => {
    const [a, b] = [ephemeris.vectors[300]!, ephemeris.vectors[301]!];
    const halfway = new Date((a.at.getTime() + b.at.getTime()) / 2);

    const speed = speedAt(ephemeris, halfway);

    expect(Math.abs(speed - speedOf(a))).toBeLessThan(0.01);
    expect(Math.abs(speed - speedOf(b))).toBeLessThan(0.01);
  });

  test("before the reboost the Ephemeris and the Elements it was made from agree within 10 m/s", () => {
    const elements = fixtureElements(ephemerisOracle.elements);
    const at = new Date("2026-09-20T08:02:00Z");

    expect(Math.abs(speedAt(ephemeris, at) - orbitalSpeed(elements, at))).toBeLessThan(0.01);
  });

  test("from Elements the speed is the propagated one", () => {
    const elements = fixtureElements(ephemerisOracle.elements);
    const at = new Date("2026-09-20T08:02:00Z");

    expect(speedAt(elements, at)).toBe(orbitalSpeed(elements, at));
  });

  test.each(ephemerisOracle.outside)("at %s, outside the Ephemeris, throws", (outside) => {
    expect(() => speedAt(ephemeris, new Date(outside))).toThrow(PropagationError);
  });
});

describe("the Ephemeris covers the instants from its first vector to its last", () => {
  test("ephemerisInterval and ephemerisCovers", () => {
    expect(ephemerisInterval(ephemeris)).toEqual({ from: new Date(ephemerisOracle.covers.from), to: new Date(ephemerisOracle.covers.to) });
    expect(ephemerisCovers(ephemeris, { from: new Date(ephemerisOracle.covers.from), to: new Date(ephemerisOracle.covers.to) })).toBe(true);
    for (const outside of ephemerisOracle.outside) {
      expect(ephemerisCovers(ephemeris, { from: new Date(outside), to: new Date(outside) })).toBe(false);
    }
  });

  test.each(ephemerisOracle.outside)("interpolating at %s, outside the Ephemeris, throws", (outside) => {
    expect(() => interpolate(ephemeris, new Date(outside))).toThrow(PropagationError);
  });
});

describe("parseEphemeris rejects an Ephemeris that cannot be trusted", () => {
  const text = fixtureEphemerisText();
  const withVectorLine = (index: number, edit: (line: string) => string) => {
    const lines = text.split("\n");
    const at = lines.findIndex((line) => /^\d{4}-/.test(line)) + index;
    lines[at] = edit(lines[at]!);
    return lines.join("\n");
  };

  test.each([
    ["an HTML document", "<html>maintenance</html>"],
    ["a frame other than J2000", text.replace("REF_FRAME            = EME2000", "REF_FRAME            = ITRF2000")],
    ["a time system other than UTC", text.replace("TIME_SYSTEM          = UTC", "TIME_SYSTEM          = TAI")],
    ["a vector with a missing component", withVectorLine(3, (line) => line.split(" ").slice(0, 6).join(" "))],
    ["a vector with an unreadable component", withVectorLine(3, (line) => line.replace(/ -?\d+\.\d+$/, " 5.3e"))],
    ["a vector inside the Earth", withVectorLine(3, (line) => line.replace(/^(\S+) \S+ \S+ \S+/, "$1 100.0 100.0 100.0"))],
    ["vectors out of order", withVectorLine(3, (line) => line.replace(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, "2026-09-01T00:00"))],
    ["a single vector", text.split("\n").filter((line) => !/^\d{4}-/.test(line) || line.startsWith("2026-09-19T12:00:00")).join("\n")],
  ])("%s", (_, corrupted) => {
    expect(() => parseEphemeris(corrupted)).toThrow(EphemerisError);
  });
});

describe("Passes and Ground tracks from an Ephemeris", () => {
  const madrid = passOracle.searches.find((search) => search.key === "madrid-3-days")!;
  // The ISS, whose Standard magnitude the Visible windows below are read by.
  const madridMagnitude = statedMagnitude(madrid);

  test("before the reboost the Ephemeris gives the Passes Skyfield finds from the Elements", () => {
    const to = new Date(ephemerisOracle.reboost.at);
    const interval = { from: new Date(madrid.from), to };
    const expected = madrid.passes.filter((pass) => new Date(pass.rise.at) < to);

    const passes = findPasses(ephemeris, madrid.observer, interval, madridMagnitude);

    expect(passes.map((pass) => pass.rise.at.toISOString().slice(0, 16))).toEqual(expected.map((pass) => pass.rise.at.slice(0, 16)));
    passes.forEach((pass, index) => expectPassToAgree(pass, expected[index]!));
  });

  test("after the reboost the Ephemeris gives the Passes Skyfield finds from the reboosted orbit, not the Elements", () => {
    const search = ephemerisOracle.passes;
    const interval = { from: new Date(search.from), to: new Date(search.to) };

    const passes = findPasses(ephemeris, search.observer, interval, madridMagnitude);

    expect(passes.map((pass) => pass.rise.at.toISOString().slice(0, 16))).toEqual(search.passes.map((pass) => pass.rise.at.slice(0, 16)));
    passes.forEach((pass, index) => {
      expectPassToAgree(pass, search.passes[index]!);
      expect(secondsApart(pass.rise.at, search.fromElements[index]!)).toBeGreaterThan(ephemerisOracle.tolerance.minPassDivergenceSeconds);
    });
    expect(passes.some((pass) => pass.visible)).toBe(true);
  });

  test("a Pass search over the whole Ephemeris takes well under 100 ms of CPU", () => {
    const interval = ephemerisInterval(ephemeris);
    findPasses(ephemeris, madrid.observer, interval, madridMagnitude);

    const started = Date.now();
    const passes = findPasses(ephemeris, madrid.observer, interval, madridMagnitude);
    const elapsed = Date.now() - started;

    expect(passes.length).toBeGreaterThan(10);
    expect(elapsed).toBeLessThan(100);
  });

  test("a Ground track from the Ephemeris passes through Skyfield's Positions", () => {
    const expected = ephemerisOracle.positions.find((position) => position.at === "2026-09-20T08:00:00.000Z")!;
    const from = new Date(expected.at);

    const track = groundTrack(ephemeris, { from, to: new Date(from.getTime() + 600_000), stepSeconds: 60 });

    expect(track).toHaveLength(11);
    expect(track[0]!.at).toEqual(from);
    expect(positionDistanceKm(track[0]!, expected)).toBeLessThan(tolerance);
  });

  test("longestPassSeconds bounds every fixture Pass from either source, at a few minutes' margin", () => {
    const durations = [...madrid.passes, ...ephemerisOracle.passes.passes].map(
      (pass) => (new Date(pass.set.at).getTime() - new Date(pass.rise.at).getTime()) / 1000,
    );
    const longest = Math.max(...durations);

    for (const source of [ephemeris, fixtureElements(ephemerisOracle.elements)]) {
      expect(longestPassSeconds(source)).toBeGreaterThan(longest);
      expect(longestPassSeconds(source)).toBeLessThan(longest + 600);
    }
  });

  test("positionAt interpolates an Ephemeris and propagates Elements", () => {
    const expected = ephemerisOracle.positions.find((position) => position.afterReboost)!;
    const at = new Date(expected.at);

    expect(positionDistanceKm(positionAt(ephemeris, at), expected)).toBeLessThan(tolerance);
    expect(positionDistanceKm(positionAt(fixtureElements(ephemerisOracle.elements), at), expected.fromElements)).toBeLessThan(tolerance);
  });
});
