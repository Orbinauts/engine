import { ecfToLookAngles, geodeticToEcf, type EcfVec3 } from "satellite.js";
import { toDegrees, toRadians, wrapAzimuth } from "./angles.js";
import { phaseAngle, predictedMagnitude } from "./brightness.js";
import { isGeostationary } from "./geostationary.js";
import type { Interval } from "./ground-track.js";
import { observerSite, type Observer } from "./position.js";
import { orbitOf, type Orbit } from "./orbit.js";
import { isEphemeris, type Source } from "./source.js";
import { sunAltitude, sunEcf } from "./sun.js";
import { DAY_MS } from "./time.js";

/** An instant of a Pass and where the Satellite is in the sky then. */
export interface PassEvent {
  at: Date;
  /** Degrees clockwise from north. */
  azimuth: number;
}

/** The instant of a Pass at which the Satellite is highest. */
export interface Culmination extends PassEvent {
  /** The Pass's maximum elevation, in degrees above the horizon. */
  elevation: number;
  /** Whether the Satellite is in sunlight rather than in the Earth's shadow. */
  sunlit: boolean;
  /** The Sun's altitude above the Observer's horizon, in degrees; negative after sunset. */
  sunAltitude: number;
  /**
   * The predicted brightness at this instant, as a magnitude: what the
   * Satellite shows when sunlit is true. Null for a Satellite the field has
   * published no Standard magnitude for, whose brightness nothing here
   * estimates: a stand-in value can land right on the threshold, and a
   * Pass would then be called Visible or not on a guess.
   */
  magnitude: number | null;
}

/**
 * Which of the Visible window's four conditions changed at one of its ends,
 * so that a caller can say why the Satellite appeared or disappeared: it rose
 * past or dropped below the rule's elevation (`elevation`), left or entered
 * the Earth's shadow (`sunlit`), the sky darkened or brightened past Night
 * (`night`), or it brightened or faded past the threshold (`brightness`).
 * When two change within the same fraction of a second, the first of that
 * order is reported.
 */
export type WindowReason = "elevation" | "sunlit" | "night" | "brightness";

/** One end of a Visible window: when the Satellite appears or disappears, where in the sky, and why. */
export interface WindowEdge extends PassEvent {
  /** Degrees above the horizon. */
  elevation: number;
  reason: WindowReason;
}

/** The brightest instant of a Visible window and the magnitude then. */
export interface Peak {
  at: Date;
  magnitude: number;
}

/**
 * The interval of a Pass during which the Satellite can be seen: the longest
 * one in which the four conditions of the Visible pass rule
 * (`VisibleRule`) hold at once.
 */
export interface VisibleWindow {
  appears: WindowEdge;
  disappears: WindowEdge;
  peak: Peak;
}

/**
 * One crossing of a Satellite above an Observer's horizon, with rise and set
 * at 0 degrees of elevation without refraction. Geometry only: `visible`
 * says whether it is a Visible pass, not whether anyone will see it.
 */
export interface Pass {
  rise: PassEvent;
  culmination: Culmination;
  set: PassEvent;
  /** The Visible window, or null when the Pass has none. */
  window: VisibleWindow | null;
  /** Whether this is a Visible pass: whether it has a Visible window. */
  visible: boolean;
}

/**
 * The Visible pass rule, as its three numbers by default. A
 * Pass is Visible while, all at once, the Observer is in Night (the Sun at
 * least 6 degrees below the horizon, nautical twilight or darker), the
 * Satellite is Sunlit, it is at least 10 degrees above the horizon, and its
 * predicted brightness is magnitude 4.0 or brighter, the faintest a naked
 * eye finds under a city sky. A caller who sets no threshold of their own
 * (`VisibleRule`) gets these.
 */
export const NIGHT_SUN_ALTITUDE = -6;
export const VISIBLE_MIN_ELEVATION = 10;
export const VISIBLE_FAINTEST_MAGNITUDE = 4;

/**
 * The three thresholds of the Visible pass rule, for a caller whose
 * definition of visible differs from the common one: a darker sky for
 * astrophotography, a higher horizon for a city street, a fainter limit for
 * binoculars.
 */
export interface VisibleRule {
  /** The lowest the Satellite may stand, in degrees above the horizon. */
  minElevation: number;
  /** The faintest it may look, as an apparent magnitude. */
  faintestMagnitude: number;
  /** The highest the Sun may stand for the Observer to be in Night, in degrees (negative: below the horizon). */
  nightSunAltitude: number;
}

/** The Visible pass rule every search applies unless told otherwise: the three numbers above. */
export const VISIBLE_RULE: Readonly<VisibleRule> = {
  minElevation: VISIBLE_MIN_ELEVATION,
  faintestMagnitude: VISIBLE_FAINTEST_MAGNITUDE,
  nightSunAltitude: NIGHT_SUN_ALTITUDE,
};

/** Any of the rule's thresholds, the rest taken from `VISIBLE_RULE`. */
export type VisibleRuleOptions = Partial<VisibleRule>;

/**
 * The whole rule from the thresholds a caller set over `VISIBLE_RULE`, an
 * explicit `undefined` falling back to the default like an absent one, and
 * nothing but the rule's thresholds kept.
 */
const ruleOf = (options: VisibleRuleOptions): VisibleRule => {
  const rule = { ...VISIBLE_RULE };
  for (const key of Object.keys(rule) as (keyof VisibleRule)[]) rule[key] = options[key] ?? rule[key];
  return rule;
};

/**
 * Every Pass of the Satellite over the Observer that overlaps the interval, in
 * time order, each reported in full: a Pass in progress at the start is
 * reported from its rise, one in progress at the end to its set. An
 * Ephemeris must therefore cover the interval extended by
 * `longestPassSeconds` at both ends.
 *
 * The search steps through the interval with a step the geometry proves safe
 * (see `Sky.step`), so that most of a 10-day search is spent far below the
 * horizon in strides of ten minutes, then refines each horizon crossing by
 * bisection and each culmination by golden-section search to a twentieth
 * of a second. The crossings are refined on a fixed grid, so a Pass is the
 * same whichever interval's search found it. Passes shorter than a second
 * can be stepped over. Nothing is fetched or stored: the search is pure
 * geometry on what the caller hands it.
 *
 * @param standardMagnitude The Satellite's Standard magnitude, the one input
 * the geometry cannot supply: how bright it looks at 1,000 km, half lit. The
 * library keeps no list of Satellites and no facts about them beyond what
 * the Elements say, so the caller brings it.
 * Absent for a Satellite the field has published no brightness for: its
 * Passes then carry a null magnitude and no Visible window, since the
 * fourth condition of the rule cannot be judged and nothing here estimates
 * it, a stand-in value being a guess that can land right on the threshold.
 * Such a Satellite is never Naked-eye, so no window is lost.
 *
 * No Pass is longer than `LONGEST_PASS_MS`, and neither walk that looks for
 * a Pass's rise or set goes further: a Satellite still above the horizon
 * that long after it rose, or that long before the interval began, is one
 * that stands in this Observer's sky rather than crossing it (an inclined
 * geosynchronous Satellite over the middle of its figure of eight, a
 * drifting one near the Observer's longitude), and has no Pass in the
 * interval for as long as it stays up.
 *
 * @throws PassesNotDefinedError for Geostationary Elements, before any
 * stepping: such a Satellite never crosses a horizon, so every walk would
 * run to its bound and find nothing, for every Observer; the Elements say
 * so before it starts.
 *
 * @param rule The thresholds each Pass's Visible window is judged by, any
 * left out taken from `VISIBLE_RULE`. The Passes themselves, from rise to
 * set, are the same whatever the rule.
 */
export function findPasses(source: Source, observer: Observer, interval: Interval, standardMagnitude?: number, rule: VisibleRuleOptions = {}): Pass[] {
  assertPassesAreDefined(source);
  return new Sky(orbitOf(source), observer, standardMagnitude, ruleOf(rule)).passesOver(interval);
}

/** The thresholds of the Visible pass rule, and the Observer's Nights when the caller has them already. */
export interface VisiblePassOptions extends VisibleRuleOptions {
  /**
   * The Observer's Nights over the interval, as `nightsOver` answers them
   * under the same `nightSunAltitude`, for a caller searching many
   * Satellites from one Observer to work out once.
   */
  nights?: readonly Interval[];
}

/**
 * Every Visible pass of the Satellite over the Observer that overlaps the
 * interval: exactly `findPasses(...)` keeping the Visible ones, the same
 * Passes to the bit, found by searching only the Observer's Nights.
 *
 * A Visible window needs the Observer in Night, so every Visible pass holds
 * an instant of Night. That instant lies in one of the interval's Nights
 * (`nightsOver`), whose search reports the Pass in full; or before the
 * interval, and then the Pass is in progress at its start; or after it,
 * and then the Pass is in progress at its end. The two ends are searched
 * as empty intervals, which report only a Pass in progress there. A
 * crossing is refined on a fixed grid (`Sky.crossing`), so the Pass one of
 * these searches finds is the one the whole interval's search finds, and a
 * Pass two of them find is kept once. Nothing is lost and nothing differs:
 * the daylight hours are simply never walked, and no Pass in them has its
 * window searched, which is where most of a low orbit's search goes. The
 * bound on a Pass's length holds the same: a Satellite that stays up longer
 * than `LONGEST_PASS_MS` has no Pass in either search, whichever interval's
 * walk meets it.
 *
 * @param options The thresholds of the rule, any left out taken from
 * `VISIBLE_RULE`, and the Observer's Nights under it if already known.
 */
export function findVisiblePasses(
  source: Source,
  observer: Observer,
  interval: Interval,
  standardMagnitude?: number,
  options: VisiblePassOptions = {},
): Pass[] {
  assertPassesAreDefined(source);
  const rule = ruleOf(options);
  const nights = options.nights ?? nightsOver(observer, interval, rule);
  const sky = new Sky(orbitOf(source), observer, standardMagnitude, rule);
  const { from, to } = interval;
  const searched = [{ from, to: from }, ...nights, { from: to, to }];
  const found = new Map<number, Pass>();
  for (const pass of searched.flatMap((part) => sky.passesOver(part))) {
    if (pass.visible) found.set(pass.rise.at.getTime(), pass);
  }
  return [...found.values()].sort((a, b) => a.rise.at.getTime() - b.rise.at.getTime());
}

/**
 * The fastest the Sun's altitude changes, in degrees per hour: no faster
 * than the Sun moves across the sky, which is the Earth's turn (15.04 an
 * hour) and the Sun's own drift along the ecliptic (0.04). Rounded up, so
 * the walk below is a bound and never an estimate.
 */
const SUN_ALTITUDE_DEGREES_PER_HOUR = 16;
/** Night's edges are pinned this closely: the refinement never has to be finer, since each edge is taken on its daylight side. */
const NIGHT_REFINE_MS = 1000;

/**
 * The Observer's Nights within the interval: every span in
 * which the Sun is below `nightSunAltitude`, 6 degrees below the horizon
 * unless the caller says otherwise (`NIGHT_SUN_ALTITUDE`), cut to the
 * interval, in time order. Each edge is taken on its Twilight side, so
 * every instant of Night is inside one.
 *
 * The Sun's altitude is walked with a step it cannot cross Night's edge
 * within, from how far it is from it and how fast it can move, so a Night
 * is never stepped over: a long stride through the middle of the day and
 * of the night, short ones only at dusk and dawn. A Night shorter than a
 * second, where the Sun only grazes the edge, can be stepped over, as a
 * Pass that short can. None where the Sun never sets that far, as in a
 * summer far north; the whole interval where it never rises that far.
 */
export function nightsOver(observer: Observer, { from, to }: Interval, { nightSunAltitude = NIGHT_SUN_ALTITUDE }: Pick<VisibleRuleOptions, "nightSunAltitude"> = {}): Interval[] {
  const end = to.getTime();
  const altitudeAt = (t: number) => sunAltitude(observer, new Date(t));
  const isNight = (altitude: number) => altitude < nightSunAltitude;
  const nights: Interval[] = [];
  let t = from.getTime();
  let altitude = altitudeAt(t);
  let nightFrom = isNight(altitude) ? t : undefined;
  while (t < end) {
    const hours = Math.abs(altitude - nightSunAltitude) / SUN_ALTITUDE_DEGREES_PER_HOUR;
    const next = Math.min(end, t + Math.max(NIGHT_REFINE_MS, hours * 3_600_000));
    const nextAltitude = altitudeAt(next);
    if (isNight(nextAltitude) !== isNight(altitude)) {
      // The edge between the two samples, pinned from its Twilight side.
      let twilight = isNight(altitude) ? next : t;
      let night = isNight(altitude) ? t : next;
      while (Math.abs(twilight - night) > NIGHT_REFINE_MS) {
        const middle = (twilight + night) / 2;
        if (isNight(altitudeAt(middle))) night = middle;
        else twilight = middle;
      }
      if (nightFrom === undefined) nightFrom = twilight;
      else {
        nights.push({ from: new Date(nightFrom), to: new Date(twilight) });
        nightFrom = undefined;
      }
    }
    t = next;
    altitude = nextAltitude;
  }
  if (nightFrom !== undefined) nights.push({ from: new Date(nightFrom), to });
  return nights;
}

/**
 * The longest a Pass may last, in milliseconds: two days. Longer than any
 * Pass of a Satellite that rises and sets over an Observer, the half-day
 * ones of Chandra's 63.5-hour orbit and the day-long ones of an inclined
 * geosynchronous orbit included, since such a Satellite retraces its path
 * over the ground once a sidereal day and so sets within one or not at
 * all. It bounds the two walks that look for a Pass's ends, which only a
 * Satellite that never sets for this Observer walks to the end of: without
 * it the walk back to the rise of a Satellite that stood in the sky had no
 * end, and a search asked for one never returned.
 */
const LONGEST_PASS_MS = 2 * DAY_MS;

/**
 * A Satellite whose orbit gives it no Pass to find, so that the caller is
 * told which Satellite and why rather than waiting on a search that cannot
 * end. It is a refusal of the question, not a failure of the computation,
 * so a caller can tell it apart from any other error and say so.
 */
export class PassesNotDefinedError extends Error {}

/**
 * Refuses the search for a Geostationary Satellite before it takes a step. A
 * Geostationary Satellite keeps over one point of the Equator, so it is
 * always in view or never, for every Observer at once: it has no Pass
 * anywhere and the Elements say so before the search walks two days to
 * learn it. The caller gets a refusal that says why, rather than an empty
 * list that could mean "none this week".
 *
 * An Ephemeris is not classified: it covers a bounded window rather than
 * an orbit, and no operator publishes one for a Geostationary Satellite.
 */
function assertPassesAreDefined(source: Source): void {
  if (isEphemeris(source) || !isGeostationary(source)) return;
  throw new PassesNotDefinedError(
    `Satellite ${source.catalogueNumber} is geostationary: it stands over one longitude of the equator and never rises or sets, so it has no passes`,
  );
}

/** The Satellite as seen from the Observer at one instant. */
interface Sample {
  /** Milliseconds since the Unix epoch. */
  t: number;
  /** Degrees above the horizon. */
  elevation: number;
  /** Degrees clockwise from north. */
  azimuth: number;
  /** Kilometres from the Observer. */
  range: number;
  /** Where the Satellite is in the Earth-fixed frame, in kilometres. */
  ecf: EcfVec3<number>;
}

/** The last sample before a condition held while walking, and the first at which it held. */
interface Bracket {
  last: Sample;
  reached: Sample;
}

/** No step is shorter than this, so a search always advances. */
const MIN_STEP_MS = 1000;
/** Crossings and culminations are refined until their bracket is this narrow. */
const REFINE_MS = 50;
/**
 * Inside a Pass the window search never strides further than this, whatever
 * the geometry would allow: a run of the four conditions shorter than this
 * can be stepped over, as a Pass shorter than a second can.
 */
const WINDOW_STEP_MS = 10_000;
const GOLDEN_RATIO = (Math.sqrt(5) - 1) / 2;
/** The phase angle at which a Satellite shows its whole lit face, and so looks as bright as the model ever makes it. */
const FULLY_LIT = 0;

/** The Observer's sky: samples of the Satellite's look angles and the searches over them. */
class Sky {
  private readonly site;
  private readonly siteEcf;
  /** Whether a Visible window is possible on this orbit at all; false makes every window search on it skippable. */
  private readonly canEverBeVisible: boolean;

  constructor(
    private readonly orbit: Orbit,
    private readonly observer: Observer,
    private readonly standardMagnitude: number | undefined,
    private readonly rule: VisibleRule,
  ) {
    this.site = observerSite(observer);
    this.siteEcf = geodeticToEcf(this.site);
    this.canEverBeVisible = this.couldReachTheThreshold();
  }

  /**
   * Whether any Pass of this Satellite over any Observer could hold a Visible
   * window at all, decided once from the orbit rather than sampled: at the
   * closest the orbit ever brings it to a point on the Earth's surface, with
   * its whole lit face turned that way, the brightness model still cannot
   * reach the faintest a Visible pass may be. No geometry within a Pass can
   * beat either extreme, so when it fails, every window search on this orbit
   * is work with one possible answer.
   *
   * It is the Naked-eye rule (`isNakedEye`) as the search's own arithmetic,
   * over the orbit the Elements describe rather than a typical altitude the
   * caller states — the library keeps no list of Satellites to look one up. A
   * Satellite with no Standard magnitude fails it too, since the fourth
   * condition of the rule can never hold without one.
   *
   * Worth deciding because the window search is the expensive half: it walks
   * a Pass at a fixed ten-second step, so it costs what the Pass is long,
   * and a deep-space Pass lasts half a day where a low one lasts ten
   * minutes. Chandra's 10-day search took 344 ms of CPU and now takes 8.
   */
  private couldReachTheThreshold(): boolean {
    if (this.standardMagnitude === undefined) return false;
    // The orbit's bound is taken against the widest the Earth is, so an
    // Observer standing above sea level is that much closer again and the
    // Satellite that much brighter. Small — about 0.06 of a magnitude on a
    // low orbit from ten kilometres above sea level — but it is the
    // difference between a bound and nearly one, and only a true bound may
    // decide not to look.
    //
    // No test of its own: the term only ever widens the bound, so it can
    // make the search look where it would have skipped and never the
    // reverse, which is why no fixture moved when it was added. Pinning its
    // effect would mean choosing a magnitude inside that 0.06 and would pin
    // the brightness model's knife-edge rather than this rule.
    //
    // The floor at zero is load-bearing, not tidiness: it reads like
    // defensive decoration and it is the opposite. An orbit whose perigee
    // is inside the Earth already bounds nothing, so `minRangeBound` is
    // zero for it, and the model at a range of zero is -Infinity, which
    // clears any threshold and makes the search look — which is the point.
    // Take the floor away and this line takes that zero below zero, the
    // model returns NaN, and `NaN <= threshold` is false, so the search
    // would silently skip every window for exactly the Satellite the zero was
    // written to protect.
    const closest = Math.max(0, this.orbit.minRangeBound - this.observer.altitude / 1000);
    return predictedMagnitude(this.standardMagnitude, closest, FULLY_LIT) <= this.rule.faintestMagnitude;
  }

  /** Every Pass that overlaps the interval, in time order, each in full, no walk going further than a Pass may last (`findPasses`). An empty interval reports only a Pass in progress at its instant. */
  passesOver(interval: Interval): Pass[] {
    const to = interval.to.getTime();
    const passes: Pass[] = [];
    const above = (sample: Sample) => sample.elevation >= 0;
    const below = (sample: Sample) => sample.elevation < 0;
    let cursor: Sample | undefined = this.at(interval.from.getTime());

    // Up as the interval starts: the Pass in progress is reported from its
    // rise, when there is one within a Pass's length before.
    if (above(cursor)) {
      const bracket = this.walk(cursor, -1, below, cursor.t - LONGEST_PASS_MS);
      cursor = bracket === undefined ? this.nextSet(cursor, to) : this.completePassInto(passes, this.crossing(bracket.reached, bracket.last), to);
    }

    while (cursor !== undefined && cursor.t < to) {
      const bracket = this.walk(cursor, 1, above, to);
      if (bracket === undefined) break;
      cursor = this.completePassInto(passes, this.crossing(bracket.last, bracket.reached), to);
    }

    return passes;
  }

  at(t: number): Sample {
    const ecf = this.orbit.ecfAt(t);
    const angles = ecfToLookAngles(this.site, ecf);
    return {
      t,
      elevation: toDegrees(angles.elevation),
      azimuth: wrapAzimuth(toDegrees(angles.azimuth)),
      range: angles.rangeSat,
      ecf,
    };
  }

  /**
   * How far the search may move from a sample without the Satellite crossing
   * the horizon unseen. Its elevation changes no faster than the line of sight
   * turns, at most the relative speed over the range, and the range shrinks
   * no faster than that speed: integrating the bound gives the step.
   */
  step(sample: Sample): number {
    const seconds = (sample.range / this.orbit.relativeSpeedBound) * (1 - Math.exp(-Math.abs(toRadians(sample.elevation))));
    return Math.max(MIN_STEP_MS, seconds * 1000);
  }

  /**
   * Walks from a sample in the direction (1 forward, -1 back) until the
   * condition holds or the limit is reached; undefined when the limit comes
   * first.
   */
  walk(start: Sample, direction: 1 | -1, until: (sample: Sample) => boolean, limit: number): Bracket | undefined {
    let last = start;
    for (;;) {
      const next = direction > 0 ? Math.min(last.t + this.step(last), limit) : Math.max(last.t - this.step(last), limit);
      if (next === last.t) return undefined;
      const reached = this.at(next);
      if (until(reached)) return { last, reached };
      last = reached;
    }
  }

  /**
   * The horizon crossing between a sample below the horizon and one above,
   * by bisection: the sample on the above side of the narrowed bracket, so
   * that a Pass always starts and ends on the horizon or just above it.
   *
   * The bracket is narrowed on a fixed grid, the instants REFINE_MS apart
   * from the Unix epoch, to the grid instant nearest the crossing on its
   * above side, rather than by halving the bracket the walk happened to
   * reach it with. The answer is then the same whichever walk bracketed the
   * crossing, and so, since everything else of a Pass is worked out from its
   * rise, is the whole Pass: a search over any interval that holds a Pass
   * finds that Pass to the bit, which `findVisiblePasses` stands on. The
   * grid instants either side of the bracket are taken to be on its sides
   * without a sample, since the elevation keeps its sense for far longer
   * than a grid step around a crossing.
   */
  crossing(below: Sample, above: Sample): Sample {
    const later = above.t > below.t;
    let fails = (later ? Math.floor : Math.ceil)(below.t / REFINE_MS);
    let holds = (later ? Math.ceil : Math.floor)(above.t / REFINE_MS);
    while (Math.abs(holds - fails) > 1) {
      const middle = Math.floor((fails + holds) / 2);
      if (this.at(middle * REFINE_MS).elevation >= 0) holds = middle;
      else fails = middle;
    }
    return this.at(holds * REFINE_MS);
  }

  /**
   * Narrows a bracket in which the condition changes until it is REFINE_MS
   * wide, and returns both sides of it: the sample where the condition
   * holds, and the one just outside where it fails.
   */
  private refine(fails: Sample, holds: Sample, condition: (sample: Sample) => boolean): { holds: Sample; fails: Sample } {
    while (Math.abs(holds.t - fails.t) > REFINE_MS) {
      const middle = this.at((fails.t + holds.t) / 2);
      if (condition(middle)) holds = middle;
      else fails = middle;
    }
    return { holds, fails };
  }

  /**
   * The Pass that rises at the sample, added to the list when it sets
   * within the longest a Pass may last; answers where the search goes on
   * from: the first sample below the horizon after the set. A Satellite
   * still up at that bound stands in this Observer's sky and has no Pass
   * there, so the search goes on from its set, if it sets before the
   * interval ends, and ends otherwise.
   */
  completePassInto(passes: Pass[], rise: Sample, to: number): Sample | undefined {
    const completed = this.completePass(rise);
    if (completed === undefined) return this.nextSet(this.at(rise.t + LONGEST_PASS_MS), to);
    passes.push(completed.pass);
    return completed.after;
  }

  /** The first sample below the horizon after one above it, no later than the instant; undefined where it is still up then. */
  nextSet(above: Sample, to: number): Sample | undefined {
    return above.t >= to ? undefined : this.walk(above, 1, (sample) => sample.elevation < 0, to)?.reached;
  }

  /** The rest of the Pass that rises at the sample, and the first sample below the horizon after it; undefined when it does not set within the longest a Pass may last. */
  private completePass(rise: Sample): { pass: Pass; after: Sample } | undefined {
    const bracket = this.walk(rise, 1, (sample) => sample.elevation < 0, rise.t + LONGEST_PASS_MS);
    if (bracket === undefined) return undefined;
    const set = this.crossing(bracket.reached, bracket.last);
    const highest = this.highest(rise.t, set.t);
    const at = new Date(highest.t);
    const culmination: Culmination = {
      at,
      azimuth: highest.azimuth,
      elevation: highest.elevation,
      sunlit: this.orbit.sunlitAt(highest.t),
      sunAltitude: sunAltitude(this.observer, at),
      magnitude: this.magnitude(highest),
    };
    const window = this.window(rise, highest, set);
    const pass: Pass = {
      rise: { at: new Date(rise.t), azimuth: rise.azimuth },
      culmination,
      set: { at: new Date(set.t), azimuth: set.azimuth },
      window,
      visible: window !== null,
    };
    return { pass, after: bracket.reached };
  }

  /** The predicted brightness at a sample, from the Standard magnitude, the range and the phase angle at the Satellite; null without one. */
  private magnitude(sample: Sample): number | null {
    if (this.standardMagnitude === undefined) return null;
    const phase = phaseAngle(sample.ecf, this.siteEcf, sunEcf(new Date(sample.t)));
    return predictedMagnitude(this.standardMagnitude, sample.range, phase);
  }

  /** The brightness at a sample inside a Visible window, always a number: without a Standard magnitude the fourth condition fails, so there is no window to be inside. */
  private brightnessInWindow(sample: Sample): number {
    return this.magnitude(sample)!;
  }

  /**
   * The first condition of the Visible pass rule that fails at a sample, in
   * the order the reasons are reported, or undefined when all four hold. The
   * order is also the cheapest: a Satellite below the minimum elevation costs nothing
   * more, one in the Earth's shadow costs no Sun altitude, and none is
   * worked out where the whole Pass is known to be in Night.
   */
  private failing(sample: Sample, night: NightDuring): WindowReason | undefined {
    if (sample.elevation < this.rule.minElevation) return "elevation";
    if (!this.orbit.sunlitAt(sample.t)) return "sunlit";
    if (night !== "throughout" && sunAltitude(this.observer, new Date(sample.t)) >= this.rule.nightSunAltitude) return "night";
    const magnitude = this.magnitude(sample);
    if (magnitude === null || magnitude > this.rule.faintestMagnitude) return "brightness";
    return undefined;
  }

  /**
   * The Pass's Visible window, or null when it has none. Elevation rises to
   * the culmination and falls back, so the window lies inside the two
   * crossings of the minimum elevation, which bound the search; between them the four
   * conditions are sampled and each run of them is refined at both ends. The
   * longest run is the window, and its brightest instant its peak.
   */
  private window(rise: Sample, highest: Sample, set: Sample): VisibleWindow | null {
    if (highest.elevation < this.rule.minElevation) return null;
    if (!this.canEverBeVisible) return null;
    const aboveMinimum = (sample: Sample) => sample.elevation >= this.rule.minElevation;
    const from = this.refine(rise, highest, aboveMinimum).holds;
    const to = this.refine(set, highest, aboveMinimum).holds;
    const night = nightDuring(this.observer, from.t, to.t, this.rule.nightSunAltitude);
    if (night === "never") return null;
    const failing = (sample: Sample) => this.failing(sample, night);

    const samples = this.samplesBetween(from, to);
    const reasons = samples.map(failing);
    let longest: { from: Sample; to: Sample; reasons: [WindowReason, WindowReason] } | undefined;
    for (let start = 0; start < samples.length; start++) {
      if (reasons[start] !== undefined) continue;
      let end = start;
      while (end + 1 < samples.length && reasons[end + 1] === undefined) end++;
      const run = this.edges(samples, reasons, start, end, failing);
      if (longest === undefined || run.to.t - run.from.t > longest.to.t - longest.from.t) longest = run;
      start = end;
    }
    if (longest === undefined) return null;

    return {
      appears: edge(longest.from, longest.reasons[0]),
      disappears: edge(longest.to, longest.reasons[1]),
      peak: this.peak(longest.from, longest.to),
    };
  }

  /** The samples of a Pass between two instants, no further apart than the window step. */
  private samplesBetween(from: Sample, to: Sample): Sample[] {
    const samples = [from];
    for (let last = from; ; ) {
      const next = last.t + Math.min(this.step(last), WINDOW_STEP_MS);
      if (next >= to.t) break;
      last = this.at(next);
      samples.push(last);
    }
    samples.push(to);
    return samples;
  }

  /**
   * The ends of a run of samples in which the four conditions hold, refined
   * to the sample where they first and last hold, each with the condition
   * that fails just outside it. A run reaching either end of the search is
   * bounded by the minimum elevation's crossing there.
   */
  private edges(samples: Sample[], reasons: (WindowReason | undefined)[], start: number, end: number, failing: Failing) {
    const opening =
      start === 0
        ? { holds: samples[0]!, reason: "elevation" as WindowReason }
        : this.refined(samples[start - 1]!, samples[start]!, failing);
    const closing =
      end === samples.length - 1
        ? { holds: samples[end]!, reason: "elevation" as WindowReason }
        : this.refined(samples[end + 1]!, samples[end]!, failing);
    return { from: opening.holds, to: closing.holds, reasons: [opening.reason, closing.reason] as [WindowReason, WindowReason] };
  }

  /** One end of a run: the bracket narrowed, with the condition that fails just outside it. */
  private refined(fails: Sample, holds: Sample, failing: Failing) {
    const bracket = this.refine(fails, holds, (sample) => failing(sample) === undefined);
    return { holds: bracket.holds, reason: failing(bracket.fails)! };
  }

  /** The brightest instant between two samples: the brightest sample of the window, then golden-section search around it. */
  private peak(from: Sample, to: Sample): Peak {
    const samples = this.samplesBetween(from, to);
    const magnitudes = samples.map((sample) => this.brightnessInWindow(sample));
    let brightest = 0;
    for (let i = 1; i < samples.length; i++) if (magnitudes[i]! < magnitudes[brightest]!) brightest = i;
    const at = this.brightest(samples[Math.max(0, brightest - 1)]!.t, samples[Math.min(samples.length - 1, brightest + 1)]!.t);
    return { at: new Date(at.t), magnitude: this.brightnessInWindow(at) };
  }

  /** The sample of maximum elevation between two instants, by golden-section search. */
  private highest(from: number, to: number): Sample {
    return this.extreme(from, to, (sample) => -sample.elevation);
  }

  /** The brightest sample between two instants, by golden-section search on the predicted magnitude. */
  private brightest(from: number, to: number): Sample {
    return this.extreme(from, to, (sample) => this.brightnessInWindow(sample));
  }

  /** The sample between two instants at which the value is least, by golden-section search. */
  private extreme(from: number, to: number, value: (sample: Sample) => number): Sample {
    let a = from;
    let b = to;
    let c = b - GOLDEN_RATIO * (b - a);
    let d = a + GOLDEN_RATIO * (b - a);
    let atC = value(this.at(c));
    let atD = value(this.at(d));
    while (b - a > REFINE_MS) {
      if (atC < atD) {
        b = d;
        d = c;
        atD = atC;
        c = b - GOLDEN_RATIO * (b - a);
        atC = value(this.at(c));
      } else {
        a = c;
        c = d;
        atC = atD;
        d = a + GOLDEN_RATIO * (b - a);
        atD = value(this.at(d));
      }
    }
    return this.at((a + b) / 2);
  }
}

/** The first condition of the rule that fails at a sample of one Pass, or undefined when all four hold. */
type Failing = (sample: Sample) => WindowReason | undefined;

/** Whether the Observer is in Night between two instants: throughout, never, or for part of the time. */
type NightDuring = "throughout" | "never" | "partly";

/**
 * Whether the Observer is in Night between two instants of a Pass, from the
 * Sun's altitude at the two ends alone where that settles it: the altitude
 * moves no faster than SUN_ALTITUDE_DEGREES_PER_HOUR, so between the ends it
 * can get no lower than where the steepest fall from one end meets the
 * steepest rise to the other, and no higher than the reverse. A Pass in
 * daylight or Twilight never is, and has no window to look for; a Pass deep
 * in the night always is, and its window search needs no Sun altitude; only
 * a Pass on the edge of Night is sampled for it. A bound, never an
 * estimate, so the window is the one sampling every instant would find.
 */
function nightDuring(observer: Observer, from: number, to: number, nightSunAltitude: number): NightDuring {
  const reach = (SUN_ALTITUDE_DEGREES_PER_HOUR * (to - from)) / 3_600_000;
  const ends = sunAltitude(observer, new Date(from)) + sunAltitude(observer, new Date(to));
  if ((ends - reach) / 2 >= nightSunAltitude) return "never";
  if ((ends + reach) / 2 < nightSunAltitude) return "throughout";
  return "partly";
}

function edge(sample: Sample, reason: WindowReason): WindowEdge {
  return { at: new Date(sample.t), azimuth: sample.azimuth, elevation: sample.elevation, reason };
}
