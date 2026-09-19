/**
 * The five Orbit classes, by the names the field and the operators give
 * them: low Earth orbit, where the ISS and Hubble go round in an hour and a
 * half; medium Earth orbit, where GPS, Galileo, GLONASS and most of BeiDou go
 * round in about half a day; the two geosynchronous ones, geostationary and
 * BeiDou's inclined ones, round once a sidereal day; and the highly
 * elliptical orbit Chandra flies, from 12,000 to 137,000 km. The
 * abbreviations are what the code answers; a reader is told the class in
 * their own language's words.
 *
 * The one list of them: the rule (`orbit-class.ts`) answers one of them for
 * any Elements, and a caller types its own records of orbits by it. This
 * module imports nothing and uses no syntax Node's own type stripping cannot
 * run, so a plain Node script can read the list from this file by its path.
 */
export const ORBIT_NAMES = ["LEO", "MEO", "IGSO", "GEO", "HEO"] as const;

/** One of those orbits' names: the Orbit class the engine reads from the Elements. */
export type OrbitName = (typeof ORBIT_NAMES)[number];

/** Whether a piece of text is one of those names, as text read from anywhere may hold anything. */
export function isOrbitName(text: string): text is OrbitName {
  return ORBIT_NAMES.some((name) => name === text);
}
