import { expect, test } from "vitest";
import { sourceAge } from "./index.js";
import { fixtureElements } from "../test/oracle.js";

test("sourceAge is the whole seconds elapsed since the epoch of the Elements", () => {
  const elements = fixtureElements("iss-2026-09-19");

  expect(sourceAge(elements, new Date("2026-09-19T08:17:41.839Z"))).toBe(3600);
  expect(sourceAge(elements, new Date("2026-09-19T08:17:42.838Z"))).toBe(3600);
});
