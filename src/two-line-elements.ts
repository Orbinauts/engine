import { ElementsError, readElements, type Elements, type Omm } from "./elements.js";
import { DAY_MS } from "./time.js";

/**
 * Reads Elements from a two-line element set (TLE), as CelesTrak and
 * Space-Track serve it and as websites print it, into the same Elements
 * `readElements` produces from the OMM object of the same set: every field,
 * the epoch and the Catalogue number equal. The OMM object is the primary
 * form, since it carries the same numbers without the format's fixed widths
 * (a Catalogue number above 99999 does not fit in two lines); this reader is
 * for the pair a developer already has.
 *
 * The name, the line some sources print above the pair, is optional and
 * trimmed; without it the object's name is empty. Throws ElementsError,
 * naming the line, when a line is not 69 characters, does not start with its
 * number, fails its checksum, or holds a field that is not what its columns
 * allow, and when the two lines are for different Catalogue numbers. The set
 * then passes through every check `readElements` makes, propagation at its
 * epoch included.
 */
export function readTwoLineElements(line1: string, line2: string, name = ""): Elements {
  const first = checkedLine(line1, 1);
  const second = checkedLine(line2, 2);
  const omm: Omm = {
    OBJECT_NAME: name.trim(),
    OBJECT_ID: internationalDesignator(first),
    EPOCH: epoch(first),
    MEAN_MOTION: decimal(second, 52, 63, "mean motion"),
    ECCENTRICITY: impliedDecimal(second, 26, 33, "eccentricity"),
    INCLINATION: decimal(second, 8, 16, "inclination"),
    RA_OF_ASC_NODE: decimal(second, 17, 25, "right ascension of the ascending node"),
    ARG_OF_PERICENTER: decimal(second, 34, 42, "argument of perigee"),
    MEAN_ANOMALY: decimal(second, 43, 51, "mean anomaly"),
    EPHEMERIS_TYPE: ephemerisType(first),
    CLASSIFICATION_TYPE: classification(first),
    NORAD_CAT_ID: catalogueNumber(first),
    ELEMENT_SET_NO: integer(first, 64, 68, "element set number"),
    REV_AT_EPOCH: integer(second, 63, 68, "revolution number"),
    BSTAR: exponential(first, 53, 61, "drag term"),
    MEAN_MOTION_DOT: signedDecimal(first, 33, 43, "first derivative of the mean motion"),
    MEAN_MOTION_DDOT: exponential(first, 44, 52, "second derivative of the mean motion"),
  };
  const other = catalogueNumber(second);
  if (other !== omm.NORAD_CAT_ID) throw new ElementsError(`Line 2 is for ${other}, line 1 for ${omm.NORAD_CAT_ID}`);
  return readElements(omm);
}

/** One line of the pair and its number, for the errors that name it. */
interface Line {
  text: string;
  number: 1 | 2;
}

const LINE_LENGTH = 69;

function checkedLine(text: string, number: 1 | 2): Line {
  const line = text.trimEnd();
  if (line.length !== LINE_LENGTH) throw new ElementsError(`Line ${number} is ${line.length} characters, not ${LINE_LENGTH}`);
  if (line[0] !== String(number) || line[1] !== " ") throw new ElementsError(`Line ${number} does not start with ${number}`);
  const written = line[68];
  const computed = checksum(line.slice(0, 68));
  if (written !== String(computed)) throw new ElementsError(`Line ${number} checksum is ${written}, not ${computed}`);
  return { text: line, number };
}

/** The format's checksum: the digits summed, each minus sign counting one, modulo 10. */
function checksum(body: string): number {
  let sum = 0;
  for (const character of body) {
    if (character === "-") sum += 1;
    else if (character >= "0" && character <= "9") sum += Number(character);
  }
  return sum % 10;
}

/** The columns from `start` to `end` (0-based, end excluded), trimmed. */
function columns(line: Line, start: number, end: number): string {
  return line.text.slice(start, end).trim();
}

function malformed(line: Line, field: string, value: string, what: string): ElementsError {
  return new ElementsError(value === "" ? `Line ${line.number} ${field} is ${what}` : `Line ${line.number} ${field} ${value} is ${what}`);
}

function catalogueNumber(line: Line): number {
  const value = columns(line, 2, 7);
  if (!/^\d+$/.test(value) || Number(value) < 1) throw malformed(line, "catalogue number", value, "not a positive integer");
  return Number(value);
}

function classification(line: Line): "U" | "C" | "S" {
  const value = columns(line, 7, 8);
  if (value !== "U" && value !== "C" && value !== "S") throw malformed(line, "classification", value, "not U, C or S");
  return value;
}

/**
 * The international designator in the OMM's form: "98067A" becomes
 * "1998-067A". An object without one, as some analyst objects are, has an
 * empty one.
 */
function internationalDesignator(line: Line): string {
  const value = columns(line, 9, 17);
  if (value === "") return "";
  const parts = /^(\d{2})(\d{3})([A-Z]{1,3})$/.exec(value);
  if (parts === null) throw malformed(line, "international designator", value, "not a year, a launch and a piece");
  return `${century(Number(parts[1]))}-${parts[2]}${parts[3]}`;
}

/** A two-digit year as the format reads it: 57 to 99 are the 1900s, 00 to 56 the 2000s. */
function century(year: number): number {
  return year < 57 ? 2000 + year : 1900 + year;
}

/**
 * The epoch in the OMM's form, to the microsecond. The day's fraction has
 * eight digits, and a hundred-millionth of a day is exactly 864 microseconds,
 * so the instant is counted in whole microseconds and never rounded.
 */
function epoch(line: Line): string {
  const value = columns(line, 18, 32);
  const parts = /^(\d{2})(\d{3})\.(\d{1,8})$/.exec(value);
  const year = parts === null ? NaN : century(Number(parts[1]));
  const day = parts === null ? NaN : Number(parts[2]);
  const daysInYear = (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / DAY_MS;
  if (parts === null || day < 1 || day > daysInYear) throw malformed(line, "epoch", value, "not a year and a day");
  const microseconds = Number(parts[3]!.padEnd(8, "0")) * 864;
  const instant = new Date(Date.UTC(year, 0, day) + Math.floor(microseconds / 1000)).toISOString();
  return `${instant.slice(0, 19)}.${String(microseconds % 1_000_000).padStart(6, "0")}`;
}

function ephemerisType(line: Line): 0 {
  const value = columns(line, 62, 63);
  if (value !== "0") throw malformed(line, "ephemeris type", value, "not SGP4 (0)");
  return 0;
}

function integer(line: Line, start: number, end: number, field: string): number {
  const value = columns(line, start, end);
  if (!/^\d+$/.test(value)) throw malformed(line, field, value, "not an integer");
  return Number(value);
}

/** An unsigned decimal with its point written, as the angles and the mean motion are. */
function decimal(line: Line, start: number, end: number, field: string): number {
  const value = columns(line, start, end);
  if (!/^(\d+\.?\d*|\.\d+)$/.test(value)) throw malformed(line, field, value, "not a number");
  return Number(value);
}

/** A signed decimal with its point written and its leading zero dropped, as in "-.00000123". */
function signedDecimal(line: Line, start: number, end: number, field: string): number {
  const value = columns(line, start, end);
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(value)) throw malformed(line, field, value, "not a number");
  return Number(value);
}

/** Digits after an implied leading point, as the eccentricity's "0004815" is 0.0004815. */
function impliedDecimal(line: Line, start: number, end: number, field: string): number {
  const value = columns(line, start, end);
  if (!/^\d+$/.test(value)) throw malformed(line, field, value, "not a number");
  return Number(`0.${value}`);
}

/** An implied leading point and a power of ten, as the drag term's "-12007-3" is -0.12007e-3. */
function exponential(line: Line, start: number, end: number, field: string): number {
  const value = columns(line, start, end);
  const parts = /^([+-]?)(\d{1,5})([+-]\d)$/.exec(value);
  if (parts === null) throw malformed(line, field, value, "not a number");
  return Number(`${parts[1]}0.${parts[2]}e${parts[3]}`);
}
