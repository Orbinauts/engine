// The orbital engine: a pure library with no HTTP or storage dependencies,
// written once in TypeScript on satellite.js and astronomy-engine so the one
// package runs on a server and in a browser alike, and tested against
// Skyfield's answers for the same inputs rather than against hand-picked
// values.
export { readElements, orbitalPeriodSeconds, ElementsError, OMM_FIELDS, type Elements, type Omm, type OmmField } from "./elements.js";
export { readTwoLineElements } from "./two-line-elements.js";
export { propagate, orbitalSpeed, PropagationError, type GroundPoint, type Observer, type Position } from "./position.js";
export { groundTrack, groundTrackByDistance, type Interval, type Sampling, type TrackPoint, type TrackSample, type Window } from "./ground-track.js";
export {
  findPasses,
  findVisiblePasses,
  NIGHT_SUN_ALTITUDE,
  nightsOver,
  PassesNotDefinedError,
  VISIBLE_FAINTEST_MAGNITUDE,
  VISIBLE_MIN_ELEVATION,
  VISIBLE_RULE,
  type Culmination,
  type Pass,
  type PassEvent,
  type VisiblePassOptions,
  type VisibleRule,
  type VisibleRuleOptions,
  type Peak,
  type VisibleWindow,
  type WindowEdge,
  type WindowReason,
} from "./passes.js";
export { predictedMagnitude, STANDARD_MAGNITUDE_RANGE_KM } from "./brightness.js";
export {
  isGeostationary,
  GEOSTATIONARY_MAX_ECCENTRICITY,
  GEOSTATIONARY_MAX_INCLINATION_DEGREES,
  GEOSTATIONARY_MEAN_MOTION,
  GEOSTATIONARY_MEAN_MOTION_BAND,
} from "./geostationary.js";
export { course, type GroundVelocity } from "./course.js";
export { propagator, type BodyState, type Propagator } from "./propagator.js";
export { isNakedEye, brightestPossibleMagnitude, type AltitudeRangeKm } from "./naked-eye.js";
export { IN_VIEW_MIN_ELEVATION, isInView, lookAngles } from "./in-view.js";
export { footprint, footprintAngleDegrees, footprintRadiusKm, latitudeBandDegrees } from "./footprint.js";
export { subsolarPoint, sunAltitude } from "./sun.js";
export { isSunlit, longestPassSeconds, nextLightChange } from "./orbit.js";
export { ORBIT_NAMES, isOrbitName, type OrbitName } from "./orbit-names.js";
export { orbitClass, GEOSYNCHRONOUS_MEAN_MOTION_WINDOW, HIGHLY_ELLIPTICAL_MIN_ECCENTRICITY, LOW_EARTH_ORBIT_KM } from "./orbit-class.js";
export { apsides, circularPeriodSeconds, orbitPhase, semiMajorAxisKm, type Apsides, type OrbitPhase } from "./orbit-shape.js";
export { applySourceRule, isEphemeris, positionAt, speedAt, sourceAge, type Source } from "./source.js";
export {
  ephemerisCovers,
  ephemerisInterval,
  interpolate,
  parseEphemeris,
  EphemerisError,
  type Ephemeris,
  type StateVector,
} from "./ephemeris.js";
export { DAY_MS, SIDEREAL_DAY_SECONDS } from "./time.js";
export { radiiOfCurvatureKm, WGS84_E2, WGS84_EQUATORIAL_KM, WGS84_POLAR_KM } from "./wgs84.js";
// Degrees and radians, and the one wrap of a longitude into [-180, 180): a map unwraps a track across the antimeridian, and whatever draws one world brings it back.
export { toDegrees, toRadians, wrapAzimuth, wrapLongitude } from "./angles.js";
// The round Earth every distance along the ground is measured on: great-circle separation, bearing and destination.
export {
  centralAngle,
  destinationPoint,
  EARTH_MEAN_RADIUS_KM,
  greatCircleKm,
  initialBearingDegrees,
  separationDegrees,
  type SpherePoint,
} from "./sphere.js";
