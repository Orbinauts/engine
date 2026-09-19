import { ecfToLookAngles, geodeticToEcf } from "satellite.js";
import { toDegrees, toRadians, wrapAzimuth } from "./angles.js";
import { observerSite, type Observer, type Position } from "./position.js";

/**
 * Where the Satellite stands in the Observer's sky at one instant: how high
 * above the horizon and in which direction, both in degrees, the elevation
 * negative while it is below.
 *
 * Taken from the point beneath the Satellite and its altitude rather than
 * from the Satellite's own vector, which is the road every horizon answer
 * here takes, so In view, the Footprint and these look angles cannot
 * disagree about where the horizon is.
 *
 * How high and in which direction is all this answers about the horizon:
 * when a Satellite next crosses it is a Pass, which `findPasses` works out
 * from a Source, the Ephemeris where one covers the search, rather than
 * from the one Position taken here.
 */
export function lookAngles(position: Position, observer: Observer): { elevation: number; azimuth: number } {
  const satelliteEcf = geodeticToEcf({
    latitude: toRadians(position.latitude),
    longitude: toRadians(position.longitude),
    height: position.altitude,
  });
  const look = ecfToLookAngles(observerSite(observer), satelliteEcf);
  return { elevation: toDegrees(look.elevation), azimuth: wrapAzimuth(toDegrees(look.azimuth)) };
}

/** The elevation at and above which a Satellite is In view unless the caller asks for another: the horizon itself, in degrees. */
export const IN_VIEW_MIN_ELEVATION = 0;

/**
 * Whether the Satellite is In view from the Observer: at or above
 * `minElevation`, by default their horizon at 0 degrees of elevation
 * without refraction, whatever the light. The question a receiver answers,
 * and the one a count of a Constellation's Satellites overhead asks of each.
 * A caller whose receiver needs a clear sky above a mask angle passes it as
 * `minElevation`.
 *
 * Pure geometry between two points, and only that: it takes the
 * Satellite's Position rather than a Source and an instant, so a caller that
 * has already propagated a whole list of Satellites to one instant — which
 * is what such a count needs — pays for no propagation here.
 * Distinct from Visible, which needs Night, Sunlit and brightness besides.
 *
 * @param options.minElevation The lowest elevation that counts, in degrees,
 * `IN_VIEW_MIN_ELEVATION` unless the caller sets another.
 */
export function isInView(position: Position, observer: Observer, options: { minElevation?: number } = {}): boolean {
  const { minElevation = IN_VIEW_MIN_ELEVATION } = options;
  return lookAngles(position, observer).elevation >= minElevation;
}
