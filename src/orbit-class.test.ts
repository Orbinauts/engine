import { describe, expect, test } from "vitest";
import { fixtureElements } from "../test/oracle.js";
import {
  apsides,
  GEOSTATIONARY_MAX_INCLINATION_DEGREES,
  GEOSTATIONARY_MEAN_MOTION,
  GEOSYNCHRONOUS_MEAN_MOTION_WINDOW,
  HIGHLY_ELLIPTICAL_MIN_ECCENTRICITY,
  isGeostationary,
  LOW_EARTH_ORBIT_KM,
  orbitClass,
  ORBIT_NAMES,
  readElements,
  type Elements,
  type Omm,
} from "./index.js";

/**
 * The Orbit class of the Skyfield-checked sets, one of
 * each class, and then each of the rule's bounds. The sets are the oracle's
 * (`oracle/positions.py`), so the apsides the rule reads are the ones the
 * orbit-shape tests hold against Skyfield's own.
 */

/** A fixture set with fields replaced: a set at a chosen distance from a bound. */
function withFields(key: string, changes: Partial<Omm>): Elements {
  return readElements({ ...fixtureElements(key).omm, ...changes });
}

describe("the Orbit class, read from the Elements", () => {
  test.each([
    ["iss-2026-09-19", "LEO"],
    ["navstar-77-2026-09-18", "MEO"],
    ["goes-19-2026-09-19", "GEO"],
    ["beidou-3-igso-1-2026-09-18", "IGSO"],
    ["chandra-2026-09-21", "HEO"],
  ] as const)("%s flies %s", (key, name) => {
    expect(orbitClass(fixtureElements(key))).toBe(name);
  });

  test("every class the rule answers is one of the five names, and the fixtures' sets fly every one of them", () => {
    const answered = [
      "iss-2026-09-19",
      "tiangong-2026-09-19",
      "hubble-2026-09-19",
      "terra-2026-09-19",
      "vanguard-1-2026-09-19",
      "navstar-54-2026-09-19",
      "galileo-19-2026-09-17",
      "goes-19-2026-09-19",
      "meteosat-12-2026-09-19",
      "hispasat-30w-6-2026-09-19",
      "beidou-3-igso-1-2026-09-18",
      "chandra-2026-09-21",
    ].map((key) => orbitClass(fixtureElements(key)));

    expect(new Set(answered)).toEqual(new Set(ORBIT_NAMES));
  });

  test("Geostationary is the Geostationary rule's answer and nothing else's", () => {
    for (const key of ["goes-19-2026-09-19", "meteosat-12-2026-09-19", "hispasat-30w-6-2026-09-19"]) {
      expect(isGeostationary(fixtureElements(key)), key).toBe(true);
      expect(orbitClass(fixtureElements(key)), key).toBe("GEO");
    }
    // Tilted past the rule's bound, GOES-19 no longer stands still: it traces a figure of eight, and the class says so.
    expect(orbitClass(withFields("goes-19-2026-09-19", { INCLINATION: GEOSTATIONARY_MAX_INCLINATION_DEGREES + 0.1 }))).toBe("IGSO");
  });

  test("inclined geosynchronous needs a period within the window of a sidereal day, and an inclination past the Geostationary bound", () => {
    const igso = "beidou-3-igso-1-2026-09-18";
    // Just inside the window either side: a period of about 21.8 and 26.6 hours.
    expect(orbitClass(withFields(igso, { MEAN_MOTION: GEOSTATIONARY_MEAN_MOTION + 0.99 * GEOSYNCHRONOUS_MEAN_MOTION_WINDOW }))).toBe("IGSO");
    expect(orbitClass(withFields(igso, { MEAN_MOTION: GEOSTATIONARY_MEAN_MOTION - 0.99 * GEOSYNCHRONOUS_MEAN_MOTION_WINDOW }))).toBe("IGSO");
    // Outside the window it is some other orbit at that inclination: here, a medium one.
    expect(orbitClass(withFields(igso, { MEAN_MOTION: GEOSTATIONARY_MEAN_MOTION + 1.1 * GEOSYNCHRONOUS_MEAN_MOTION_WINDOW }))).toBe("MEO");
    // At the Geostationary bound's inclination a circular day-long orbit is Geostationary, however tilted the rest of BeiDou's are.
    expect(orbitClass(withFields(igso, { INCLINATION: GEOSTATIONARY_MAX_INCLINATION_DEGREES, ECCENTRICITY: 0.001 }))).toBe("GEO");
  });

  test("the window keeps clear of the navigation orbits, the nearest other family: Galileo goes round 1.7 times a day and GPS twice", () => {
    expect(GEOSTATIONARY_MEAN_MOTION + GEOSYNCHRONOUS_MEAN_MOTION_WINDOW).toBeLessThan(fixtureElements("galileo-19-2026-09-17").omm.MEAN_MOTION);
    expect(orbitClass(fixtureElements("galileo-19-2026-09-17"))).toBe("MEO");
  });

  test("an orbit more eccentric than a quarter is highly elliptical, whatever its height", () => {
    const vanguard = "vanguard-1-2026-09-19";
    expect(orbitClass(withFields(vanguard, { ECCENTRICITY: HIGHLY_ELLIPTICAL_MIN_ECCENTRICITY }))).not.toBe("HEO");
    expect(orbitClass(withFields(vanguard, { ECCENTRICITY: HIGHLY_ELLIPTICAL_MIN_ECCENTRICITY + 0.001 }))).toBe("HEO");
  });

  test("below the eccentricity bound, the apogee decides: a whole orbit under 2,000 km is low, one reaching past it medium", () => {
    // Vanguard 1 dips to 655 km but climbs to 3,821: its orbit is not a low one, and it is not eccentric enough to be highly elliptical.
    const vanguard = fixtureElements("vanguard-1-2026-09-19");
    expect(apsides(vanguard).perigeeKm).toBeLessThan(LOW_EARTH_ORBIT_KM);
    expect(apsides(vanguard).apogeeKm).toBeGreaterThan(LOW_EARTH_ORBIT_KM);
    expect(orbitClass(vanguard)).toBe("MEO");

    // Terra's orbit, raised until its apogee sits either side of the line.
    const terra = fixtureElements("terra-2026-09-19");
    const justBelow = withFields("terra-2026-09-19", { MEAN_MOTION: 11.4 });
    const justAbove = withFields("terra-2026-09-19", { MEAN_MOTION: 11.2 });
    expect(orbitClass(terra)).toBe("LEO");
    expect(apsides(justBelow).apogeeKm).toBeLessThan(LOW_EARTH_ORBIT_KM);
    expect(orbitClass(justBelow)).toBe("LEO");
    expect(apsides(justAbove).apogeeKm).toBeGreaterThan(LOW_EARTH_ORBIT_KM);
    expect(orbitClass(justAbove)).toBe("MEO");
  });
});
