# @orbinauts/engine

Satellite positions, passes and visibility from orbital elements, in TypeScript, checked against Skyfield.

The engine behind [Orbinauts](https://orbinauts.com), the live satellite map and pass predictions.

[satellite.js](https://github.com/shashwatak/satellite-js) propagates a satellite with SGP4 and stops there. This library takes the next steps: where the satellite is over the ground, every pass over an observer with rise, culmination and set, whether it is in the Earth's shadow, how bright it looks, and which passes a person can actually see. Every answer is compared with [Skyfield](https://rhodesmill.org/skyfield/) on the same inputs, within the tolerances [listed below](#how-far-to-trust-it).

- Positions: the point beneath the satellite, its altitude and speed, from OMM or two-line Elements, or interpolated from a CCSDS OEM ephemeris.
- Ground tracks, sampled by time or by distance along the ground.
- Passes over an observer, and Visible passes with the window in which the satellite can be seen, under thresholds you choose.
- Sunlight and Earth shadow, predicted magnitude, look angles, footprints, orbit class, apsides and period.
- Great-circle geometry on the sphere: separation, bearing and destination.

No function fetches, stores or reads the environment: you hand it Elements and an observer, it hands back numbers.

[API reference](https://orbinauts.github.io/engine/) · [Changelog](CHANGELOG.md) · [Design record](docs/decisions/0001-typescript-library-python-oracle.md)

## Install

```sh
npm install @orbinauts/engine
```

The package is ESM only, ships TypeScript declarations and source maps, and depends on satellite.js and astronomy-engine.

## Quick start

Read the Elements of the International Space Station, put an observer in London and ask for the Visible passes of the next three days:

```js
import { findVisiblePasses, readElements } from "@orbinauts/engine";

// The ISS as CelesTrak served it on 2026-09-19, an OMM object in JSON.
const iss = readElements({
  OBJECT_NAME: "ISS (ZARYA)",
  OBJECT_ID: "1998-067A",
  EPOCH: "2026-09-19T07:17:41.839008",
  MEAN_MOTION: 15.49175317,
  ECCENTRICITY: 0.0004815,
  INCLINATION: 51.6308,
  RA_OF_ASC_NODE: 194.2901,
  ARG_OF_PERICENTER: 157.3949,
  MEAN_ANOMALY: 202.7252,
  EPHEMERIS_TYPE: 0,
  CLASSIFICATION_TYPE: "U",
  NORAD_CAT_ID: 25544,
  ELEMENT_SET_NO: 999,
  REV_AT_EPOCH: 58634,
  BSTAR: 0.00012007,
  MEAN_MOTION_DOT: 6.211e-5,
  MEAN_MOTION_DDOT: 0,
});

// An observer: degrees north, degrees east, metres above the WGS84 ellipsoid.
const london = { latitude: 51.5074, longitude: -0.1278, altitude: 11 };
const threeDays = { from: new Date("2026-09-19T12:00:00Z"), to: new Date("2026-09-22T12:00:00Z") };

// -1.8 is the ISS's standard magnitude, how bright it looks at 1,000 km half
// lit: the one number the Elements cannot give, needed to judge brightness.
const passes = findVisiblePasses(iss, london, threeDays, -1.8);

for (const { culmination, window } of passes) {
  if (window === null) continue; // never, for a Visible pass; it narrows the type
  const appears = window.appears.at.toISOString();
  const disappears = window.disappears.at.toISOString();
  console.log(
    `${appears.slice(0, 10)} ${appears.slice(11, 16)} to ${disappears.slice(11, 16)} UTC, ` +
      `up to ${culmination.elevation.toFixed(0)}°, magnitude ${window.peak.magnitude.toFixed(1)}`,
  );
}
```

It prints:

```text
2026-09-19 20:03 to 20:07 UTC, up to 71°, magnitude -4.0
2026-09-20 19:16 to 19:21 UTC, up to 84°, magnitude -4.0
2026-09-20 20:52 to 20:54 UTC, up to 31°, magnitude -1.1
2026-09-21 18:34 to 18:35 UTC, up to 88°, magnitude -2.0
2026-09-21 20:05 to 20:08 UTC, up to 43°, magnitude -3.2
```

A Visible pass is one during which, all at once, the observer's sky is dark (the Sun at least 6° below the horizon), the satellite is in sunlight, at least 10° up and magnitude 4.0 or brighter. Those are the defaults, exported as `VISIBLE_RULE`; pass your own as the last argument, for instance `{ minElevation: 20, faintestMagnitude: 5 }`. `findPasses` answers every pass, visible or not, each with a `visible` flag and its window.

### Two-line elements

The OMM object is the primary form: it carries the same numbers as a two-line set, without the fixed columns, so catalogue numbers above 99999 fit. For the pair you already have, `readTwoLineElements(line1, line2, name)` reads it into the same Elements `readElements` gives for the OMM object of the same set.

## How far to trust it

The Oracle, a set of [Skyfield](https://rhodesmill.org/skyfield/) scripts in [`oracle/`](https://github.com/Orbinauts/engine/tree/main/oracle), computes the same quantities for the same Elements, observers and instants and writes them into [`fixtures/`](https://github.com/Orbinauts/engine/tree/main/fixtures) with a tolerance for each. The tests fail when the library's answer is further from Skyfield's than that. Skyfield runs Vallado's reference SGP4 through the `sgp4` package, and JPL's DE421 ephemeris for the Sun.

| Quantity | Tolerance | Fixture |
| --- | --- | --- |
| Position from Elements: latitude, longitude and altitude, as a distance | 1 km | `positions.json` `positionKm` |
| Position interpolated from an OEM ephemeris, as a distance | 1 km | `ephemeris.json` `positionKm` |
| Speed along the orbit | 0.001 km/s | `positions.json` `speedKmPerSecond` |
| Orbital period from the mean motion | 0.01 s | `positions.json` `periodSeconds` |
| Apogee and perigee altitudes | 0.001 km | `positions.json` `apsidesKm` |
| Orbit phase, as mean anomaly | 0.001° | `positions.json` `meanAnomalyDegrees` |
| Course, the direction the ground point moves | 0.05° | `positions.json` `courseDegrees` |
| Subsolar point, latitude and longitude | 0.01° | `positions.json` `subsolarDegrees` |
| Footprint ring, point by point (a sphere here, the WGS84 ellipsoid in Skyfield) | 10 km | `positions.json` `footprintKm` |
| Rise, culmination and set; the ends and the brightest instant of a Visible window | 2 s | `passes.json` `timeSeconds` |
| Maximum elevation; elevation at each end of a Visible window | 0.1° | `passes.json` `elevationDegrees` |
| Azimuth at rise, culmination, set and each window end, as distance on the sky | 0.5° | `passes.json` `azimuthDegrees` |
| Sun's altitude at culmination | 0.05° | `passes.json` `sunAltitudeDegrees` |
| Predicted magnitude at culmination and at a window's brightest instant | 0.05 mag | `passes.json` `magnitude` |
| Place in the sky at a window end, added per second the two instants differ | 1.2°/s | `passes.json` `skyDegreesPerSecond` |
| In view or not: identical, on scenes with no satellite within 1° of the horizon | 1° | `in-view.json` `edgeMarginDegrees` |

Sunlit or not at culmination, Visible or not, and why a window opens and closes must match exactly. The Elements are CelesTrak's general perturbations sets for eighteen satellites in low, medium, geostationary, inclined geosynchronous and highly elliptical orbits, taken on 2026-09-19, and two historic ISS sets, of 2008 from Wikipedia's two-line element set article and of 2014 from Skyfield's documentation. The ephemeris is simulated by the Oracle, with a reboost in it, and says so in its header.

satellite.js, which does the propagation, passes Vallado's SGP4 verification cases in its own test suite.

## Runtimes

- **Node** 22 or later. CI runs on Node 22 and 24.
- **Browsers**, through a bundler: the library is ES2022 modules and imports no Node built-in, a rule its own tests enforce. See the next section for one bundler setting.
- **Cloudflare Workers**: nothing to configure; Wrangler's build takes the package as it is.

## Browsers

satellite.js 7 carries a WebAssembly propagator for bulk work, which it loads through two package-internal imports, `#wasm-single-thread` and `#wasm-multi-thread`. This library never calls it, but a bundler follows the imports anyway, and the runtimes behind them import `node:module` and `node:worker_threads`: esbuild then fails a browser build, and other bundlers warn and drag Node-only code in. Point both imports at an empty module:

```js
// empty.js
export default {};
```

With Vite:

```js
// vite.config.js
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const empty = fileURLToPath(new URL("./empty.js", import.meta.url));

export default defineConfig({
  resolve: {
    alias: { "#wasm-single-thread": empty, "#wasm-multi-thread": empty },
  },
});
```

With esbuild:

```sh
esbuild app.js --bundle --platform=browser \
  --alias:#wasm-single-thread=./empty.js --alias:#wasm-multi-thread=./empty.js
```

If a later satellite.js renames the two imports, the warnings come back and the aliases do nothing; nothing else breaks.

## Where fresh Elements come from

SGP4 is only as good as the Elements' epoch is recent: a low orbit drifts by kilometres a day, so fetch new sets daily for anything in low Earth orbit.

- **[CelesTrak](https://celestrak.org/NORAD/documentation/gp-data-formats.php)** serves the public catalogue's sets as OMM JSON with no account, for example `https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=json` for the ISS. It answers an array; hand an item to `readElements`.
- **[Space-Track](https://www.space-track.org/)**, the source of the catalogue, serves the same sets and their history to registered users, as OMM JSON (`readElements`) or two lines (`readTwoLineElements`). Its user agreement governs what you may do with the data.
- **The [Orbinauts API](https://api.orbinauts.com/v1/docs)** answers the current Elements of a satellite by name or catalogue number, `https://api.orbinauts.com/v1/bodies/iss/elements`, with the OMM object under `elements`, and computes positions, tracks and passes itself when you would rather not.

```js
const response = await fetch("https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=json");
const [omm] = await response.json();
const iss = readElements(omm);
```

## Contributing and security

Patches are welcome; [CONTRIBUTING.md](CONTRIBUTING.md) says how they land. Report a vulnerability privately, as [SECURITY.md](SECURITY.md) describes.

## Licence

[MIT](LICENSE), © Orbinauts contributors.
