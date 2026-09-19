"""Generate the Geostationary fixture for the engine from Skyfield.

Run from the engine package with `uv run --project oracle --locked
oracle/geostationary.py`, or every script in turn with `pnpm fixtures`. The engine
reads Geostationary off the Elements alone — the mean motion, the
eccentricity and the inclination against the bounds `geostationary.ts`
exports — which is a claim about where the Satellite goes, and this script is
what holds that claim to an independent propagator. For each of the four
sidereal-day Satellites in `oracle/positions.py` it records, from Skyfield:

* how far the point beneath the Satellite wanders over two days, in latitude
  and in longitude, which is the definition itself (a Geostationary orbit
  "keeps a Satellite over one longitude of the equator");
* how many Observers of a grid over the whole Earth ever see the Satellite
  cross their horizon in the ten days a Pass search may cover, which is the
  consequence the engine's guard rests on ("from any Observer it is always
  in view or never, and it has no Passes").

Observers within `EDGE_MARGIN_DEGREES` of the edge of what the Satellite sees
at the epoch are left out of that count: at the edge the horizon is where
the Satellite is, so a hair of libration puts it either side and the crossing
says nothing about the orbit. The count is of Observers clear of that edge.

It then measures the one bound that decides anything for real sidereal-day
Satellites. All four published sets are inclined by under a degree or
by 59, so nothing among them lies near
`GEOSTATIONARY_MAX_INCLINATION_DEGREES`; the rule is at its widest there,
and what it costs is what the last section reports. GOES-19's Elements are
taken with the inclination raised to that bound, every Observer of the grid
kept this time, and the script records how many see it rise and set and the
highest it ever climbs above the horizon of one who does. That number is
the honest price of the bound: the Passes it refuses.

The fixture is written to `fixtures/geostationary.json`. Python is a
development-time oracle only.
"""

import json
from datetime import timedelta
from pathlib import Path

import numpy as np
from positions import ELEMENTS, iso, load, skyfield_satellite
from skyfield.api import EarthSatellite, wgs84

# The four sets of `positions.py` whose period is a sidereal day, with what
# the Geostationary rule must say of each. The three that stand over one
# longitude are two weather satellites and a communications one; BeiDou 3
# IGSO-1 is geosynchronous by period and eccentricity but inclined by 59
# degrees, so it traces a figure of eight across a third of the Earth and is
# not Geostationary: the point beneath it does not keep to one longitude of
# the equator.
SUBJECTS = {
    "goes-19-2026-09-19": True,
    "meteosat-12-2026-09-19": True,
    "hispasat-30w-6-2026-09-19": True,
    "beidou-3-igso-1-2026-09-18": False,
}

# The sub-point is followed over this long from the epoch, at this step: two
# turns of the daily figure, finely enough that its corners are not missed.
SUB_POINT_DAYS = 2
SUB_POINT_STEP_MINUTES = 1

# Horizon crossings are looked for over ten days, a long Pass search, at a
# step far shorter than any crossing a
# Satellite of this period can make.
CROSSING_DAYS = 10
CROSSING_STEP_MINUTES = 15

# The grid of Observers, at sea level: every this many degrees of latitude
# and longitude, the poles left out.
GRID_STEP_DEGREES = 10

# Observers this close to the edge of what the Satellite sees at the epoch are
# left out of the crossing count: there the Satellite sits on the horizon, so
# which side of it the Observer is on is not a fact about the orbit.
EDGE_MARGIN_DEGREES = 3.0

# The rule's widest case: the set the bound is measured on, and the bound
# itself, which `geostationary.ts` exports as
# GEOSTATIONARY_MAX_INCLINATION_DEGREES. The two must be changed together.
AT_THE_BOUND_ELEMENTS = "goes-19-2026-09-19"
MAX_INCLINATION_DEGREES = 5.0

# The Visible window needs the Satellite at least this far above the horizon
# (the engine's VISIBLE_MIN_ELEVATION), which is what the highest crossing
# below is compared against.
VISIBLE_MIN_ELEVATION = 10.0


def observers() -> list[tuple[float, float]]:
    """The grid of Observers, as latitude and longitude in degrees."""
    latitudes = range(-80, 81, GRID_STEP_DEGREES)
    longitudes = range(-180, 180, GRID_STEP_DEGREES)
    return [(float(latitude), float(longitude)) for latitude in latitudes for longitude in longitudes]


def at_the_bound(timescale) -> EarthSatellite:
    """GOES-19 with its orbit tilted to the rule's inclination bound, and nothing else changed."""
    omm = {**ELEMENTS[AT_THE_BOUND_ELEMENTS], "INCLINATION": MAX_INCLINATION_DEGREES}
    return EarthSatellite.from_omm(timescale, omm)


def unwrapped_span(degrees: np.ndarray) -> float:
    """The span of a sequence of longitudes, following it across the antimeridian."""
    unwrapped = np.degrees(np.unwrap(np.radians(degrees)))
    return float(unwrapped.max() - unwrapped.min())


def main() -> None:
    timescale = load.timescale(builtin=True)
    grid = observers()
    subjects = []

    for key, expected in SUBJECTS.items():
        satellite = skyfield_satellite(key, timescale)
        epoch = satellite.epoch.utc_datetime()

        followed = timescale.from_datetimes(
            [epoch + timedelta(minutes=SUB_POINT_STEP_MINUTES * i) for i in range(SUB_POINT_DAYS * 24 * 60 // SUB_POINT_STEP_MINUTES + 1)]
        )
        beneath = wgs84.geographic_position_of(satellite.at(followed))
        latitudes = beneath.latitude.degrees
        longitudes = beneath.longitude.degrees

        # Where the Satellite sits in each Observer's sky over the whole window,
        # one Observer at a time with the instants vectorised.
        stepped = timescale.from_datetimes(
            [epoch + timedelta(minutes=CROSSING_STEP_MINUTES * i) for i in range(CROSSING_DAYS * 24 * 60 // CROSSING_STEP_MINUTES + 1)]
        )
        crossing = 0
        counted = 0
        for latitude, longitude in grid:
            elevations = (satellite - wgs84.latlon(latitude, longitude)).at(stepped).altaz()[0].degrees
            if abs(elevations[0]) < EDGE_MARGIN_DEGREES:
                continue
            counted += 1
            if elevations.min() < 0 < elevations.max():
                crossing += 1

        subjects.append(
            {
                "elements": key,
                "geostationary": expected,
                "from": iso(epoch),
                "subPoint": {
                    "days": SUB_POINT_DAYS,
                    "stepMinutes": SUB_POINT_STEP_MINUTES,
                    "latitudeSpanDegrees": round(float(latitudes.max() - latitudes.min()), 4),
                    "longitudeSpanDegrees": round(unwrapped_span(longitudes), 4),
                },
                "horizon": {
                    "days": CROSSING_DAYS,
                    "stepMinutes": CROSSING_STEP_MINUTES,
                    "observers": counted,
                    "seeingACrossing": crossing,
                },
            }
        )

    fixture = {
        "generatedBy": "oracle/geostationary.py with Skyfield",
        "grid": {"stepDegrees": GRID_STEP_DEGREES, "edgeMarginDegrees": EDGE_MARGIN_DEGREES},
        "subjects": subjects,
        "atTheBound": at_the_bound_report(timescale, grid),
    }
    out = Path(__file__).resolve().parent.parent / "fixtures" / "geostationary.json"
    out.write_text(json.dumps(fixture, indent=2) + "\n")
    print(f"wrote {len(subjects)} subjects and the bound to {out}")


def at_the_bound_report(timescale, grid: list[tuple[float, float]]) -> dict:
    """What the rule's widest case costs: of every Observer on Earth, how
    many see the Satellite rise and set over the search window, and the highest
    it ever climbs above the horizon of one who does."""
    satellite = at_the_bound(timescale)
    epoch = satellite.epoch.utc_datetime()
    stepped = timescale.from_datetimes(
        [epoch + timedelta(minutes=CROSSING_STEP_MINUTES * i) for i in range(CROSSING_DAYS * 24 * 60 // CROSSING_STEP_MINUTES + 1)]
    )
    beneath = wgs84.geographic_position_of(satellite.at(stepped))
    crossing = 0
    highest = 0.0
    for latitude, longitude in grid:
        elevations = (satellite - wgs84.latlon(latitude, longitude)).at(stepped).altaz()[0].degrees
        if elevations.min() < 0 < elevations.max():
            crossing += 1
            highest = max(highest, float(elevations.max()))
    return {
        "elements": AT_THE_BOUND_ELEMENTS,
        "inclinationDegrees": MAX_INCLINATION_DEGREES,
        "days": CROSSING_DAYS,
        "stepMinutes": CROSSING_STEP_MINUTES,
        "subPointLatitudeSpanDegrees": round(float(beneath.latitude.degrees.max() - beneath.latitude.degrees.min()), 4),
        "observers": len(grid),
        "seeingACrossing": crossing,
        "highestCrossingElevationDegrees": round(highest, 2),
        "visibleMinElevationDegrees": VISIBLE_MIN_ELEVATION,
    }


if __name__ == "__main__":
    main()
