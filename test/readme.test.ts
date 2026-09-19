import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import * as engine from "../src/index.js";

/**
 * The README against the proof. Its tolerances table states, for each
 * quantity compared with Skyfield, the number the Oracle wrote into the
 * fixture, and its quick start prints what the library answers; both are
 * read here, so the README cannot drift from either.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const README = readFileSync(resolve(ROOT, "README.md"), "utf8");
const PACKAGE_NAME = (JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")) as { name: string }).name;

/** The text of the README's section under a second-level heading, up to the next one. */
function section(heading: string): string {
  const start = README.indexOf(`\n## ${heading}\n`);
  if (start === -1) throw new Error(`The README has no section "${heading}"`);
  const end = README.indexOf("\n## ", start + 1);
  return README.slice(start, end === -1 ? undefined : end);
}

/** The body of the first fenced block of the language in the text. */
function fenced(text: string, language: string): string {
  const match = new RegExp("```" + language + "\\n([\\s\\S]*?)```").exec(text);
  if (match === null) throw new Error(`No ${language} block`);
  return match[1]!;
}

interface Row {
  quantity: string;
  value: number;
  unit: string;
  file: string;
  key: string;
}

/** The rows of the tolerances table, each tolerance split into its number and unit, each fixture cell into its file and key. */
function toleranceRows(): Row[] {
  const lines = section("How far to trust it")
    .split("\n")
    .filter((line) => line.startsWith("|"));
  expect(lines[0]).toBe("| Quantity | Tolerance | Fixture |");
  return lines.slice(2).map((line) => {
    const [quantity, tolerance, fixture] = line.split("|").slice(1, -1).map((cell) => cell.trim());
    const amount = /^(\d+(?:\.\d+)?) ?(km\/s|km|s|°\/s|°|mag)$/.exec(tolerance!);
    const source = /^`([a-z-]+\.json)` `([A-Za-z]+)`$/.exec(fixture!);
    if (amount === null) throw new Error(`Unreadable tolerance "${tolerance}" for ${quantity}`);
    if (source === null) throw new Error(`Unreadable fixture "${fixture}" for ${quantity}`);
    return { quantity: quantity!, value: Number(amount[1]), unit: amount[2]!, file: source[1]!, key: source[2]! };
  });
}

type Fixture = { tolerance?: Record<string, number> } & Record<string, unknown>;

const fixtures = new Map<string, Fixture>();
function fixture(file: string): Fixture {
  if (!fixtures.has(file)) fixtures.set(file, JSON.parse(readFileSync(resolve(ROOT, "fixtures", file), "utf8")) as Fixture);
  return fixtures.get(file)!;
}

/** The number a fixture states under the key: in its tolerance record, or at its top level. */
function stated(file: string, key: string): number | undefined {
  const { tolerance = {}, ...rest } = fixture(file);
  const value = tolerance[key] ?? rest[key];
  return typeof value === "number" ? value : undefined;
}

/** The unit a fixture key's name gives its number, as the README writes it. */
function unitOf(key: string): string {
  if (key.endsWith("KmPerSecond")) return "km/s";
  if (key.endsWith("DegreesPerSecond")) return "°/s";
  if (key.endsWith("Km")) return "km";
  if (key.endsWith("Seconds")) return "s";
  if (key.endsWith("Degrees")) return "°";
  if (key === "magnitude") return "mag";
  throw new Error(`No unit for the fixture key ${key}`);
}

/**
 * Numbers the fixtures carry beside their tolerances that are not one: they
 * guard the Ephemeris scenario (the Elements and the Ephemeris must disagree
 * by at least this much after the reboost, or the scenario proves nothing).
 */
const SCENARIO_GUARDS = new Set(["ephemeris.json minDivergenceKm", "ephemeris.json minPassDivergenceSeconds"]);

describe("the README's tolerances table", () => {
  const rows = toleranceRows();

  test.each(rows.map((row) => [row.quantity, row] as const))("%s: the number the Oracle wrote", (_, row) => {
    expect(stated(row.file, row.key), `${row.file} has no ${row.key}`).toBeDefined();
    expect(row.value).toBe(stated(row.file, row.key));
    expect(row.unit).toBe(unitOf(row.key));
  });

  test("states every tolerance the fixtures carry", () => {
    const inTable = new Set(rows.map((row) => `${row.file} ${row.key}`));
    const carried = ["positions.json", "passes.json", "ephemeris.json"].flatMap((file) => Object.keys(fixture(file).tolerance ?? {}).map((key) => `${file} ${key}`));
    carried.push("in-view.json edgeMarginDegrees");
    expect(carried.filter((entry) => !SCENARIO_GUARDS.has(entry) && !inTable.has(entry))).toEqual([]);
  });
});

/** One line the quick start prints: a Visible window's day, ends, the Pass's highest elevation and the window's brightest magnitude. */
const LINE = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}) to (\d{2}:\d{2}) UTC, up to (\d+)°, magnitude (-?\d+\.\d)$/;

interface Printed {
  appears: number;
  disappears: number;
  elevation: number;
  magnitude: number;
}

function parseLine(line: string): Printed {
  const match = LINE.exec(line);
  if (match === null) throw new Error(`Not a quick start line: "${line}"`);
  const [, day, appears, disappears, elevation, magnitude] = match;
  const minutes = (time: string) => Date.parse(`${day}T${time}:00Z`) / 60_000;
  return { appears: minutes(appears!), disappears: minutes(disappears!), elevation: Number(elevation), magnitude: Number(magnitude) };
}

describe("the README's quick start", () => {
  const code = fenced(section("Quick start"), "js");
  const printed = fenced(section("Quick start"), "text").trimEnd().split("\n");

  /** Runs the quick start as printed, its one import bound to the library's source, and answers what it logged. */
  async function run(): Promise<string[]> {
    const importLine = /^import \{ ([\w, ]+) \} from "([^"]+)";\n/.exec(code);
    expect(importLine, "the quick start opens with its one import").not.toBeNull();
    expect(importLine![2], "the quick start imports the package by its name").toBe(PACKAGE_NAME);
    const names = importLine![1]!.split(", ");
    const bindings = names.map((name) => (engine as Record<string, unknown>)[name]);
    expect(bindings.every((binding) => binding !== undefined), `the package exports ${names.join(", ")}`).toBe(true);
    const logged: string[] = [];
    const log = { log: (...parts: unknown[]) => logged.push(parts.join(" ")) };
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...args: string[]) => (...values: unknown[]) => Promise<void>;
    await new AsyncFunction(...names, "console", code.slice(importLine![0].length))(...bindings, log);
    return logged;
  }

  test("prints what the README says it prints, to the minute, the degree and the tenth of a magnitude", async () => {
    const logged = await run();
    // On a failure the message holds what the quick start printed now, to paste into the README.
    const now = `the quick start now prints:\n${logged.join("\n")}`;
    expect(logged.length, now).toBe(printed.length);
    logged.forEach((line, index) => {
      const actual = parseLine(line);
      const shown = parseLine(printed[index]!);
      // Minutes are cut, not rounded, so an instant a second from the turn of
      // a minute may print either side of it as the dependencies move.
      expect(Math.abs(actual.appears - shown.appears), now).toBeLessThanOrEqual(1);
      expect(Math.abs(actual.disappears - shown.disappears), now).toBeLessThanOrEqual(1);
      expect(Math.abs(actual.elevation - shown.elevation), now).toBeLessThanOrEqual(1);
      expect(Math.abs(actual.magnitude - shown.magnitude), now).toBeLessThanOrEqual(0.1 + 1e-9);
    });
  });
});
