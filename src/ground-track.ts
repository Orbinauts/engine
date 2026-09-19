import { separationDegrees } from "./sphere.js";
import { orbitOf } from "./orbit.js";
import type { GroundPoint, Position } from "./position.js";
import { positionAt, type Source } from "./source.js";
import { isSunlitBy, sunPosition } from "./sun.js";

/** A span of time, from one instant to a later one. */
export interface Interval {
  from: Date;
  to: Date;
}

export interface Window extends Interval {
  stepSeconds: number;
}

export interface TrackPoint extends Position {
  at: Date;
}

/**
 * A point of a Ground track to draw: a TrackPoint that also says whether
 * the Satellite is Sunlit there, so a map can draw the stretch it spends in
 * the Earth's shadow fainter.
 */
export interface TrackSample extends TrackPoint {
  /** Whether the Satellite is in the Sun's light at this instant rather than in the Earth's shadow. */
  sunlit: boolean;
}

/**
 * The Positions of a Satellite over a window, one per step from `from` up to
 * the last step that does not pass `to`, from either source.
 */
export function groundTrack(source: Source, window: Window): TrackPoint[] {
  const stepMs = window.stepSeconds * 1000;
  const points: TrackPoint[] = [];
  for (let time = window.from.getTime(); time <= window.to.getTime(); time += stepMs) points.push(trackPoint(source, time));
  return points;
}

/**
 * How a Ground track is sampled when the bound is a ground distance rather
 * than a clock: no two neighbouring points further apart along the ground
 * than `maxSeparationDegrees`, at steps between the two limits.
 */
export interface Sampling extends Interval {
  /** Degrees of Earth between neighbouring sub-points, at most; the floor below may leave a step over it. */
  maxSeparationDegrees: number;
  /** No step is shorter than this, whatever the bound asks: the floor on what one track costs to draw. */
  minStepSeconds: number;
  /** No step is longer than this, however slowly the sub-point moves: the ceiling that keeps a barely-moving figure drawn at all. */
  maxStepSeconds: number;
}

/**
 * The Positions of a Satellite over a window, sampled by how far its
 * sub-point moves rather than by the clock. A fixed step is a
 * duration, and a duration is not a distance: an eccentric orbit spends as
 * long at a perigee racing at 6.2 km/s as at an apogee crawling at 0.8, so
 * a step fine enough for the one draws hundreds of needless points for the
 * other, and a step cheap enough for the other tears the one into chords of
 * a thousand kilometres.
 *
 * The walk starts on the fixed grid `maxStepSeconds` gives and halves any
 * step whose ends are further apart than the bound, down to
 * `minStepSeconds`. So the ceiling still decides what a slow sub-point
 * costs — a Geostationary Satellite's figure is the grid and nothing more —
 * the floor still decides what a fast one costs, and the points in between
 * are spent where the line bends.
 *
 * Both ends of the window are drawn, so the track covers exactly the span
 * it was asked for and its last step is bounded like every other. Where
 * `groundTrack` stops at the last whole step, this cannot: the caller draws
 * a track ending now against a Satellite standing there, and stopping a step
 * short would leave the very gap the bound exists to close.
 *
 * Every point says whether the Satellite is Sunlit there, by the same
 * shadow test `isSunlit` runs, against one Sun for the whole window: the
 * Sun's at the window's middle. Over half an orbit the Sun moves a few
 * hundredths of a degree against the stars, which moves the ISS's shadow
 * crossings by under a second, and over half a day it moves half a
 * degree, which moves a Geostationary Satellite's by under a minute: either
 * is finer than the steps the track is drawn in, and one Sun per line is
 * one solar ephemeris instead of hundreds.
 */
export function groundTrackByDistance(source: Source, sampling: Sampling): TrackSample[] {
  const from = sampling.from.getTime();
  const spanMs = sampling.to.getTime() - from;
  const sunlitAt = sunlitOver(source, new Date(from + spanMs / 2));
  const sampleAt = (time: number): TrackSample => ({ ...trackPoint(source, time), sunlit: sunlitAt(time) });
  // The grid divides the window into as few whole steps as the ceiling
  // allows, rather than being laid from one end and stopping where it runs
  // out: every step is the same, none is longer than the ceiling, and the
  // last lands on `to` exactly rather than a hair from it.
  const steps = Math.max(1, Math.ceil(spanMs / (sampling.maxStepSeconds * 1000)));
  const start = sampleAt(from);
  const points: TrackSample[] = [start];
  let previous = start;
  for (let step = 1; step <= steps; step++) {
    previous = append(sampleAt, previous, sampleAt(step === steps ? sampling.to.getTime() : from + (spanMs * step) / steps), points, sampling);
  }
  return points;
}

/** Appends one point of the walk with whatever the bound needs between it and the one before, and hands it back as the new last point. */
function append(sampleAt: (time: number) => TrackSample, previous: TrackSample, point: TrackSample, points: TrackSample[], sampling: Sampling): TrackSample {
  addPointsBetween(sampleAt, previous, point, points, sampling);
  points.push(point);
  return point;
}

/**
 * The points that bring one step inside the bound, appended to `points` in
 * order and without its own two ends: none where the ends are already close
 * enough or the step is already the shortest allowed, and otherwise the
 * instant halfway between them and whatever each half needs in turn.
 */
function addPointsBetween(sampleAt: (time: number) => TrackSample, from: TrackSample, to: TrackSample, points: TrackSample[], sampling: Sampling): void {
  const spanMs = to.at.getTime() - from.at.getTime();
  // Halving a step shorter than two floors would put one under the floor, so such a step is left as it is however far it reaches.
  if (spanMs < 2 * sampling.minStepSeconds * 1000 || separationDegrees(from, to) <= sampling.maxSeparationDegrees) return;
  const middle = sampleAt(from.at.getTime() + Math.floor(spanMs / 2));
  addPointsBetween(sampleAt, from, middle, points, sampling);
  points.push(middle);
  addPointsBetween(sampleAt, middle, to, points, sampling);
}

/**
 * Whether the Satellite is Sunlit at an instant of a window, tested against
 * the Sun at one instant of it rather than at each: the Sun taken once in
 * the frame the source's positions are in, as `isSunlit` takes it.
 */
function sunlitOver(source: Source, sunAt: Date): (time: number) => boolean {
  const orbit = orbitOf(source);
  const sun = sunPosition(sunAt, orbit.frame);
  return (time) => isSunlitBy(orbit.inertialAt(time), sun);
}

/** The Satellite's Position at an instant, as a point of a track. */
function trackPoint(source: Source, time: number): TrackPoint {
  const at = new Date(time);
  return { at, ...positionAt(source, at) };
}
