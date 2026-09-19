# Changelog

Every notable change to `@orbinauts/engine`, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the package follows [semantic versioning](https://semver.org/spec/v2.0.0.html): until 1.0.0, a minor version may change the public interface, and the entry says how.

## [0.1.2] - 2026-09-19

No change to the library's code.

### Changed

- The README names the project the engine was written for, and the manifest's homepage is its site.

## [0.1.1] - 2026-09-19

No change to the library's code; this release carries the repository's fixes.

### Fixed

- The Oracle writes the synthetic ephemeris fixture in millimetres and millimetres per second, so a regeneration on Linux matches one on macOS.
- The publish workflow waits up to twenty minutes for the registry to serve a new version before its smoke test.

## [0.1.0] - 2026-09-19

The first release.

### Added

- Elements from an OMM object (`readElements`), as CelesTrak and Space-Track serve it in JSON, and from a two-line element set (`readTwoLineElements`), both into the same `Elements`.
- Positions propagated with SGP4 (`propagate`, `orbitalSpeed`, `propagator`), and positions and speeds interpolated from a CCSDS OEM ephemeris (`parseEphemeris`, `interpolate`).
- Ground tracks sampled by time (`groundTrack`) or by distance along the ground (`groundTrackByDistance`).
- Passes over an observer (`findPasses`) and Visible passes with their Visible window (`findVisiblePasses`, `nightsOver`), under thresholds the caller may set, the common convention (`VISIBLE_RULE`) by default.
- Sunlight and Earth shadow (`isSunlit`, `nextLightChange`), the Sun's altitude and subsolar point, predicted magnitude (`predictedMagnitude`, `isNakedEye`), look angles and an in-view test (`lookAngles`, `isInView`).
- Footprints, orbit class, apsides, period and orbit phase, and a geostationary test.
- A source rule that prefers an ephemeris while it covers the instants asked for and is younger than a limit the caller gives, and the age of whichever source it chose (`applySourceRule`, `sourceAge`).
- Great-circle geometry on the sphere: separation, bearing and destination.
- The Oracle: Skyfield scripts, with a lockfile, that regenerate every fixture the tests compare against.

[0.1.2]: https://github.com/Orbinauts/engine/releases/tag/v0.1.2
[0.1.1]: https://github.com/Orbinauts/engine/releases/tag/v0.1.1
[0.1.0]: https://github.com/Orbinauts/engine/releases/tag/v0.1.0
