import { json2satrec, propagate, type OMMJsonObject, type SatRec } from "satellite.js";

/**
 * The published orbital parameters of a Satellite at an epoch: the CCSDS
 * Orbit Mean-Elements Message (OMM) object keyed by the standard names, as
 * Space-Track serves it in JSON, with the Catalogue number and the epoch
 * derived from it once when it is read. The OMM object is the primary form
 * `readElements` reads; `readTwoLineElements` reads the same set from its
 * two lines into the same Elements.
 */
export interface Elements {
  /** From NORAD_CAT_ID: a positive integer of any width. */
  catalogueNumber: number;
  /** From EPOCH. */
  epoch: Date;
  /** The message itself, every field checked and every numeric field a number. */
  omm: Omm;
}

/**
 * The OMM fields the engine keeps, in the standard's order: the one list a
 * caller can mirror in its own schema. `Omm` has exactly these keys;
 * the compiler holds the two together in `readElements`.
 */
export const OMM_FIELDS = [
  "OBJECT_NAME",
  "OBJECT_ID",
  "EPOCH",
  "MEAN_MOTION",
  "ECCENTRICITY",
  "INCLINATION",
  "RA_OF_ASC_NODE",
  "ARG_OF_PERICENTER",
  "MEAN_ANOMALY",
  "EPHEMERIS_TYPE",
  "CLASSIFICATION_TYPE",
  "NORAD_CAT_ID",
  "ELEMENT_SET_NO",
  "REV_AT_EPOCH",
  "BSTAR",
  "MEAN_MOTION_DOT",
  "MEAN_MOTION_DDOT",
] as const;

/** The name of one OMM field the engine keeps. */
export type OmmField = (typeof OMM_FIELDS)[number];

/** The OMM fields the engine keeps, in the units the standard gives them. */
export interface Omm {
  OBJECT_NAME: string;
  /** The international designator, as in "1998-067A". */
  OBJECT_ID: string;
  /** UTC, as in "2026-09-19T07:17:41.839008"; the zone designator is optional. */
  EPOCH: string;
  /** Revolutions per day. */
  MEAN_MOTION: number;
  ECCENTRICITY: number;
  /** Degrees. */
  INCLINATION: number;
  /** Degrees. */
  RA_OF_ASC_NODE: number;
  /** Degrees. */
  ARG_OF_PERICENTER: number;
  /** Degrees. */
  MEAN_ANOMALY: number;
  /** 0: SGP4, the only theory the engine propagates. */
  EPHEMERIS_TYPE: 0;
  /** Unclassified, classified or secret. */
  CLASSIFICATION_TYPE: "U" | "C" | "S";
  /** The Catalogue number. */
  NORAD_CAT_ID: number;
  ELEMENT_SET_NO: number;
  REV_AT_EPOCH: number;
  /** The drag term, in inverse Earth radii. */
  BSTAR: number;
  /** Half the first derivative of the mean motion, in revolutions per day squared. */
  MEAN_MOTION_DOT: number;
  /** A sixth of the second derivative of the mean motion, in revolutions per day cubed. */
  MEAN_MOTION_DDOT: number;
}

export class ElementsError extends Error {}

/**
 * Reads Elements from an OMM object, whatever shape it arrives in. Throws
 * ElementsError when a field is missing, a numeric field is not a finite
 * number, the epoch is not a UTC instant, the Catalogue number is not a
 * positive integer, the theory is not SGP4, the classification is not one
 * of the three the catalogue uses, or the set cannot be propagated
 * at its own epoch, so that a caller never keeps corrupt Elements in place
 * of good ones. Fields outside the message, such as the catalogue metadata
 * Space-Track serves beside it, are left out.
 */
export function readElements(input: unknown): Elements {
  if (typeof input !== "object" || input === null) {
    throw new ElementsError("Elements are not an object");
  }
  const fields = input as Fields;
  // Each field through its reader, in the list's order. The mapped type is
  // assignable to Omm only when the list and Omm's keys are one set.
  const omm: Omm = Object.fromEntries(OMM_FIELDS.map((name) => [name, readers[name](fields, name)])) as { [F in OmmField]: Omm[F] };
  const elements = { catalogueNumber: omm.NORAD_CAT_ID, epoch: parseEpoch(omm.EPOCH), omm };
  assertPropagates(elements);
  return elements;
}

/**
 * The time one orbit takes according to the mean motion in the Elements,
 * in seconds: the window a Ground track of one orbit covers.
 */
export function orbitalPeriodSeconds(elements: Elements): number {
  return 86_400 / elements.omm.MEAN_MOTION;
}

type Fields = Record<string, unknown>;

/** How each field is read: through the check its kind needs. */
const readers: { [F in keyof Omm]: (fields: Fields, name: string) => Omm[F] } = {
  OBJECT_NAME: text,
  OBJECT_ID: text,
  EPOCH: text,
  MEAN_MOTION: decimal,
  ECCENTRICITY: decimal,
  INCLINATION: decimal,
  RA_OF_ASC_NODE: decimal,
  ARG_OF_PERICENTER: decimal,
  MEAN_ANOMALY: decimal,
  EPHEMERIS_TYPE: ephemerisType,
  CLASSIFICATION_TYPE: classificationType,
  NORAD_CAT_ID: positiveInteger,
  ELEMENT_SET_NO: integer,
  REV_AT_EPOCH: integer,
  BSTAR: decimal,
  MEAN_MOTION_DOT: decimal,
  MEAN_MOTION_DDOT: decimal,
};

function present(fields: Fields, name: string): unknown {
  const value = fields[name];
  if (value === undefined || value === null) throw new ElementsError(`${name} is missing`);
  return value;
}

function text(fields: Fields, name: string): string {
  const value = present(fields, name);
  if (typeof value !== "string") throw new ElementsError(`${name} is not text`);
  return value;
}

/** A decimal number, written as JSON does or as the text Space-Track serves. */
const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

function decimal(fields: Fields, name: string): number {
  const value = present(fields, name);
  const number = typeof value === "string" && DECIMAL.test(value.trim()) ? Number(value) : value;
  if (typeof number !== "number" || !Number.isFinite(number)) throw new ElementsError(`${name} is not a finite number`);
  return number;
}

function integer(fields: Fields, name: string): number {
  const number = decimal(fields, name);
  if (!Number.isInteger(number)) throw new ElementsError(`${name} is not an integer`);
  return number;
}

function positiveInteger(fields: Fields, name: string): number {
  const number = integer(fields, name);
  if (number < 1) throw new ElementsError(`${name} is not a positive integer`);
  return number;
}

function ephemerisType(fields: Fields, name: string): 0 {
  const type = integer(fields, name);
  if (type !== 0) throw new ElementsError(`${name} ${type} is not SGP4 (0)`);
  return 0;
}

function classificationType(fields: Fields, name: string): "U" | "C" | "S" {
  const value = text(fields, name);
  if (value !== "U" && value !== "C" && value !== "S") throw new ElementsError(`${name} ${value} is not U, C or S`);
  return value;
}

/** A CCSDS UTC instant: the calendar form, an optional fraction, an optional zone designator. */
const UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?$/;

function parseEpoch(value: string): Date {
  const epoch = new Date(value.endsWith("Z") ? value : `${value}Z`);
  if (!UTC_INSTANT.test(value) || Number.isNaN(epoch.getTime())) throw new ElementsError("EPOCH is not a UTC instant");
  return epoch;
}

/** Propagates once at the epoch to catch sets whose numbers describe no orbit. */
function assertPropagates(elements: Elements): void {
  const satrec = toSatRec(elements);
  const state = satrec.error === 0 ? propagate(satrec, elements.epoch) : null;
  const position = state?.position;
  if (typeof position !== "object" || !Number.isFinite(position.x + position.y + position.z)) {
    throw new ElementsError(`Elements do not propagate (satellite.js error ${satrec.error})`);
  }
}

const satRecs = new WeakMap<Elements, SatRec>();

/** The satellite.js propagation record for these Elements, built once per Elements object. */
export function toSatRec(elements: Elements): SatRec {
  let satrec = satRecs.get(elements);
  if (satrec === undefined) {
    // satellite.js narrows CLASSIFICATION_TYPE to U or C, a field it never reads; Space-Track also serves S.
    satrec = json2satrec(elements.omm as OMMJsonObject);
    satRecs.set(elements, satrec);
  }
  return satrec;
}
