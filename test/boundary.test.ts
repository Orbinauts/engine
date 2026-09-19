import { readdirSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, test } from "vitest";

/**
 * The package's boundary and hygiene, over every file it carries: its
 * source, its tests, the Oracle's scripts, the fixtures and the
 * configuration. Two promises are checked here rather than trusted.
 *
 * The boundary: the library imports nothing but satellite.js,
 * astronomy-engine and its own files, and no Node built-in, so it runs
 * unchanged in Node, in a browser and in Workers. The tests may also import
 * vitest; this folder's support code, which runs only under Node, may import
 * Node's built-ins and the TypeScript compiler it reads the source with.
 *
 * The hygiene: a reader who has only this package finds no pointer to
 * something they cannot open (an issue number, a design record or glossary
 * kept elsewhere, a path in another repository) and no word about the
 * product the library was written for (its pages, cards, panels, the service
 * that serves it or that service's error codes). A comment explains a
 * decision in place.
 *
 * The documents at the package's root (the README, the changelog, the
 * licence) speak for the project and may name it, so they are not walked.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Folders not walked: those tools write (installs, builds, caches) and the
 * documentation folder, which like the root's documents speaks for the
 * project.
 */
const SKIPPED = new Set(["node_modules", "dist", "docs", ".venv", "__pycache__", ".pytest_cache", ".turbo", ".git"]);

/** The documents at the root, which speak for the project. */
const DOCUMENT = /^(?:[A-Z]+(?:\.md)?|LICENSE(?:\.\w+)?)$/;

function walk(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) return SKIPPED.has(entry.name) ? [] : walk(path);
    if (folder === ROOT && DOCUMENT.test(entry.name)) return [];
    return [relative(ROOT, path).split(sep).join("/")];
  });
}

const FILES = walk(ROOT);

const isFixture = (file: string) => file.startsWith("fixtures/");
const isLock = (file: string) => file.endsWith(".lock");

/** What a line of text may not say, with why, and whether a file is exempt. */
interface Rule {
  readonly name: string;
  readonly pattern: RegExp;
  readonly skip?: (file: string) => boolean;
}

/** Every `@orbinauts` or `Orbinauts` a file may carry: the package's own names. */
const OWN_NAMES = /@orbinauts\/engine|Orbinauts\/engine|orbinauts-engine-oracle|ORBINAUTS ENGINE ORACLE|Orbinauts contributors|https:\/\/orbinauts\.com/g;

/**
 * Space-Track may be named as a server of a data format ("the OMM as
 * Space-Track serves it", "fields CelesTrak and Space-Track serve as
 * text"): a reader can check that against any set they download. It may not
 * be named as where a set came from, since Space-Track's terms forbid passing
 * its data on, and every set here comes from somewhere that allows it.
 */
const SPACE_TRACK_AS_FORMAT = /Space-Track(?:\s+(?:and|or)\s+CelesTrak)?\s+(?:also\s+)?serves?\b|CelesTrak\s+(?:and|or)\s+Space-Track\s+(?:also\s+)?serve\b/g;

/**
 * GitHub Pages, where the reference is published, may be named by the names
 * GitHub fixes for it: its own, its actions, its permission and its
 * environment. Any other "page" is one of a site.
 */
const GITHUB_PAGES = /GitHub Pages|\bgithub-pages\b|\b(?:configure|upload|deploy)-pages\b|\bpages:\s*write\b/g;

const RULES: readonly Rule[] = [
  { name: "an issue reference", pattern: /(?<![\w&/#])#\d+\b/, skip: isLock },
  { name: "a design record by number", pattern: /\bADRs?\b/ },
  { name: "a glossary kept elsewhere", pattern: /CONTEXT\.md|\bglossary\b/i },
  { name: "a path in another repository", pattern: /(?<![\w.-])(?:apps|docs|research|packages|tools|\.memory)\/[\w.-]/, skip: isLock },
  { name: "a site's page", pattern: /\bpages?\b/i, skip: isFixture },
  { name: "a card", pattern: /\bcards?\b/i, skip: isFixture },
  { name: "a panel", pattern: /\bpanels?\b/i, skip: isFixture },
  { name: "the site", pattern: /\bthe site\b|\bsite's\b/i, skip: isFixture },
  // A Worker is a service; "Workers", the runtime, is one the library runs in.
  { name: "a service", pattern: /\bWorker\b|\bthe API\b|\bAPI's\b|\bAPI Worker\b/ },
  // A three-digit number is an HTTP status when it is said to be one or is
  // given as an answer ("a 503 with no body", "its own 422 (`code`)"), not
  // when it measures something ("a 400 km orbit", "127 of the 580").
  { name: "an HTTP status", pattern: /\bHTTP\s*[1-5]\d\d\b|\bstatus(?: code)?\s+[1-5]\d\d\b|\b(?:an?|its(?: own)?)\s+[45]\d\d\b(?=\s+(?:with|for|error|response|answer|when|if)\b|\s*\(|\s*$)/, skip: (file) => isFixture(file) || isLock(file) },
  { name: "the product's visitors", pattern: /\bvisitors?\b/i },
  { name: "an error code", pattern: /[`"'][a-z]+(?:_[a-z]+)*_(?:unavailable|not_found|not_defined|not_published|not_sampled|stale|parameter|limited|origin|error|not_a_body)[`"']/ },
  { name: "a product name", pattern: /orbinauts/i },
  { name: "Space-Track as a source", pattern: /space-track/i },
  { name: "an email address", pattern: /[\w.+-]+@[\w-]+\.[a-z]{2,}/i },
];

/** This file states the rules, so it names what it forbids. */
const RULE_BOOK = "test/boundary.test.ts";

function breaches(file: string): string[] {
  if (file === RULE_BOOK || /\.(?:bsp|png|jpg|gif|ico|woff2?)$/.test(file)) return [];
  const text = readFileSync(join(ROOT, file), "utf8");
  return text.split("\n").flatMap((raw, index) => {
    const line = raw.replace(OWN_NAMES, "").replace(SPACE_TRACK_AS_FORMAT, "").replace(GITHUB_PAGES, "");
    return RULES.filter((rule) => !rule.skip?.(file) && rule.pattern.test(line)).map((rule) => `${file}:${index + 1}: ${rule.name}: ${raw.trim()}`);
  });
}

const NODE_BUILT_INS = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));

/** The modules a file of this folder may import besides relative paths, by where it lives. */
function allowedImports(file: string): (specifier: string) => boolean {
  const library = (specifier: string) => specifier === "satellite.js" || specifier === "astronomy-engine";
  if (file.startsWith("src/") && !file.endsWith(".test.ts")) return library;
  if (file.startsWith("src/")) return (specifier) => library(specifier) || specifier === "vitest";
  if (file.startsWith("test/")) return (specifier) => library(specifier) || specifier === "vitest" || specifier === "typescript" || NODE_BUILT_INS.has(specifier);
  return (specifier) => specifier === "vitest/config";
}

function importsOf(file: string): string[] {
  const text = readFileSync(join(ROOT, file), "utf8");
  return ts.preProcessFile(text, true, true).importedFiles.map((imported) => imported.fileName);
}

const TYPESCRIPT = FILES.filter((file) => [".ts", ".mts", ".js", ".mjs"].includes(extname(file)));

describe("the package's boundary", () => {
  test("is walked over its source, its tests, the Oracle, the fixtures and the configuration", () => {
    for (const prefix of ["src/", "test/", "oracle/", "fixtures/"]) expect(FILES.some((file) => file.startsWith(prefix))).toBe(true);
    expect(FILES).toContain("package.json");
    expect(FILES).toContain("test/boundary.test.ts");
  });

  test.each(TYPESCRIPT)("%s imports only what its place allows, and a relative path stays inside the package", (file) => {
    const allowed = allowedImports(file);
    const outside = importsOf(file).filter((specifier) => {
      if (specifier.startsWith("./") || specifier.startsWith("../")) {
        return relative(ROOT, resolve(ROOT, dirname(file), specifier)).startsWith("..");
      }
      return !allowed(specifier);
    });
    expect(outside).toEqual([]);
  });

  test("the library's own files import no Node built-in", () => {
    const library = TYPESCRIPT.filter((file) => file.startsWith("src/"));
    expect(library.length).toBeGreaterThan(0);
    const reaching = library.flatMap((file) => importsOf(file).filter((specifier) => NODE_BUILT_INS.has(specifier.split("/")[0]!) || specifier.startsWith("node:")).map((specifier) => `${file}: ${specifier}`));
    expect(reaching).toEqual([]);
  });

  test("the Oracle's scripts import only the standard library, their declared dependencies and each other", () => {
    const scripts = FILES.filter((file) => file.startsWith("oracle/") && file.endsWith(".py"));
    expect(scripts.length).toBeGreaterThan(0);
    const manifest = readFileSync(join(ROOT, "oracle/pyproject.toml"), "utf8");
    const declared = [...(manifest.match(/dependencies\s*=\s*\[([^\]]*)\]/)?.[1] ?? "").matchAll(/"([A-Za-z0-9_.-]+)/g)].map((match) => match[1]!.toLowerCase());
    expect(declared.length).toBeGreaterThan(0);
    const siblings = scripts.map((file) => file.slice("oracle/".length, -".py".length));
    // The standard modules the scripts use; one more is added here on purpose.
    const standard = ["json", "math", "datetime", "pathlib"];
    const allowed = new Set([...declared, ...siblings, ...standard]);
    const outside = scripts.flatMap((file) =>
      [...readFileSync(join(ROOT, file), "utf8").matchAll(/^\s*(?:import\s+([\w.]+)|from\s+([\w.]+)\s+import\b)/gm)]
        .map((match) => (match[1] ?? match[2])!.split(".")[0]!)
        .filter((module) => !allowed.has(module))
        .map((module) => `${file}: ${module}`),
    );
    expect(outside).toEqual([]);
  });
});

describe("the package's text", () => {
  test("names nothing a reader of the package alone cannot open, and nothing of the product it was written for", () => {
    expect(FILES.flatMap(breaches)).toEqual([]);
  });

  test.each([
    ["an issue reference", "fixed in #12", true],
    ["an issue reference", "the colour #fff and `# 2 steps`", false],
    ["a design record by number", "decided in ADR 0003", true],
    ["a glossary kept elsewhere", "the Source rule (CONTEXT.md)", true],
    ["a path in another repository", "from research/brightness.md", true],
    ["a site's page", "a Satellite page says", true],
    ["a site's page", "published to GitHub Pages with actions/deploy-pages", false],
    ["a site's page", "the Pages deployment", true],
    ["a card", "the In view card", true],
    ["a service", "the API turns it into an error", true],
    ["a service", "runs in browsers and Workers", false],
    ["an HTTP status", "its own 422", true],
    ["an HTTP status", "answered as a 503 with no body", true],
    ["an HTTP status", "a 400 km orbit, about 410 and 430 km", false],
    ["an HTTP status", "127 of the 580", false],
    ["the product's visitors", "runs in every visitor's browser", true],
    ["an error code", "answers `orbit_not_found`", true],
    ["a product name", "as the Orbinauts map shows", true],
    ["a product name", "import from @orbinauts/engine", false],
    ["Space-Track as a source", "the Space-Track set of that day", true],
    ["Space-Track as a source", "from space-track.org", true],
    ["Space-Track as a source", "the OMM as Space-Track serves it in JSON", false],
    ["Space-Track as a source", "as CelesTrak and Space-Track serve it", false],
    ["an email address", "write to someone@example.com", true],
  ] as const)("the rule against %s, on %j, fires: %s", (name, line, fires) => {
    const rule = RULES.find((candidate) => candidate.name === name)!;
    const cleaned = line.replace(OWN_NAMES, "").replace(SPACE_TRACK_AS_FORMAT, "").replace(GITHUB_PAGES, "");
    expect(rule.pattern.test(cleaned)).toBe(fires);
  });
});
