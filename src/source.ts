import type { Elements } from "./elements.js";
import { ephemerisCovers, interpolate, interpolateSpeed, type Ephemeris } from "./ephemeris.js";
import type { Interval } from "./ground-track.js";
import { orbitalSpeed, propagate, type Position } from "./position.js";
import { DAY_MS } from "./time.js";

/** What a Position is computed from: the Elements of a Satellite or its Ephemeris. */
export type Source = Elements | Ephemeris;

/** Whether the source is an Ephemeris rather than Elements. */
export function isEphemeris(source: Source): source is Ephemeris {
  return "vectors" in source;
}

/**
 * The Source rule, which picks what a position or a Pass is computed from:
 * the Ephemeris when it covers every instant
 * of the interval and was issued less than `freshnessDays` before `now`,
 * otherwise the Elements. For a single instant, pass an interval of no
 * length; for a Pass search, extend the interval by `longestPassSeconds` at
 * both ends.
 *
 * @param freshnessDays How long an Ephemeris keeps answering after it was
 * issued, in days: how far the caller trusts an operator's prediction over
 * fresher Elements is a policy, not geometry, so the caller states it.
 */
export function applySourceRule(
  candidates: { elements: Elements; ephemeris: Ephemeris | undefined },
  interval: Interval,
  now: Date,
  freshnessDays: number,
): Source {
  const { elements, ephemeris } = candidates;
  if (ephemeris === undefined || !ephemerisCovers(ephemeris, interval)) return elements;
  const ageMs = now.getTime() - ephemeris.issuedAt.getTime();
  return ageMs < freshnessDays * DAY_MS ? ephemeris : elements;
}

/** The Position from either source at the instant: propagated from Elements, interpolated from an Ephemeris. */
export function positionAt(source: Source, at: Date): Position {
  return isEphemeris(source) ? interpolate(source, at) : propagate(source, at);
}

/** The speed along the orbit from either source at the instant, in kilometres per second: propagated from Elements, interpolated from an Ephemeris. */
export function speedAt(source: Source, at: Date): number {
  return isEphemeris(source) ? interpolateSpeed(source, at) : orbitalSpeed(source, at);
}

/**
 * Source age: whole seconds elapsed since the epoch of the Elements, or
 * since the Ephemeris was issued.
 */
export function sourceAge(source: Source, now: Date): number {
  const since = isEphemeris(source) ? source.issuedAt : source.epoch;
  return Math.floor((now.getTime() - since.getTime()) / 1000);
}
