"""Generate the In view fixture for the engine from Skyfield.

Run from the engine package with `uv run --project oracle --locked
oracle/in-view.py`, or every script in turn with `pnpm fixtures`. In view is the
question a receiver answers: is the Satellite above the Observer's horizon at
this instant, whatever the light. The engine answers it from a
Position and an Observer alone — the point beneath the Satellite, its altitude,
and the point the Observer stands on — where Skyfield answers it from the
topocentric altitude of the Satellite itself. The two routes are not the same
arithmetic, and this script is what holds the engine's to the other one.

For each scene below it records, per Satellite, the elevation Skyfield gives
and whether it is up, and the count of those that are: how many of a
Constellation's Satellites a receiver there has overhead. The fixture lists them under the key `satellites`.
The engine's test propagates the same Elements to
the same instant, asks `isInView` of each Position, and must reproduce every
flag and the count.

A Satellite within `EDGE_MARGIN_DEGREES` of the horizon would decide the count
on a hair, so the script refuses to write a scene that has one: what is
pinned must be a fact about the sky and not about the last digit of either
propagator.

The fixture is written to `fixtures/in-view.json`. Python is a
development-time oracle only.
"""

import json
from datetime import datetime, timezone
from pathlib import Path

from positions import ELEMENTS, iso, load, skyfield_satellite
from skyfield.api import wgs84

# The Satellites every scene looks at: the four GPS and two Galileo sets of
# `oracle/positions.py`. A handful, not a Constellation: the count is proved
# on a set small enough to read in the fixture and check by hand.
SATELLITES = [
    "navstar-54-2026-09-19",
    "navstar-58-2026-09-19",
    "navstar-69-2026-09-18",
    "navstar-77-2026-09-18",
    "galileo-19-2026-09-17",
    "galileo-31-2026-09-19",
]

# A Satellite whose elevation is within this of the horizon is too close to it
# for the scene to pin: which side of zero it falls on would then follow from
# the propagator rather than from the sky.
EDGE_MARGIN_DEGREES = 1.0

# Each scene: an Observer (altitude in metres) and the instant its sky is
# counted at, chosen so that the count is neither none nor every Satellite
# and no Satellite sits on the horizon.
SCENES = [
    {
        # Madrid, the Observer the Pass fixtures use, on the evening of the
        # Satellites' epochs.
        "key": "madrid",
        "observer": {"latitude": 40.4168, "longitude": -3.7038, "altitude": 657},
        "at": datetime(2026, 9, 19, 17, 0, tzinfo=timezone.utc),
    },
    {
        # The far side of the Earth at that same instant. Every Satellite
        # Madrid sees is one Wellington does not and the other way about, so
        # the two scenes together prove the count is read off the sky and not
        # off the list.
        "key": "wellington",
        "observer": {"latitude": -41.2866, "longitude": 174.7756, "altitude": 13},
        "at": datetime(2026, 9, 19, 17, 0, tzinfo=timezone.utc),
    },
    {
        # Madrid again seven hours on: a GPS or Galileo orbit is twelve hours,
        # so the sky over one point has turned into a different one and the
        # count falls to one.
        "key": "madrid-seven-hours-later",
        "observer": {"latitude": 40.4168, "longitude": -3.7038, "altitude": 657},
        "at": datetime(2026, 9, 20, 0, 0, tzinfo=timezone.utc),
    },
]


def scene_record(scene: dict, timescale) -> dict:
    """One scene as the fixture records it: every Satellite's elevation and
    whether it is up, and how many are."""
    observer = scene["observer"]
    topos = wgs84.latlon(observer["latitude"], observer["longitude"], elevation_m=observer["altitude"])
    t = timescale.from_datetime(scene["at"])

    satellites = []
    for key in SATELLITES:
        elevation, _, _ = (skyfield_satellite(key, timescale) - topos).at(t).altaz()
        degrees = float(elevation.degrees)
        if abs(degrees) < EDGE_MARGIN_DEGREES:
            raise SystemExit(f"{scene['key']}: {key} is {degrees:.3f} degrees up, too near the horizon to pin; move the instant")
        satellites.append({"elements": key, "catalogueNumber": ELEMENTS[key]["NORAD_CAT_ID"], "elevation": round(degrees, 4), "inView": degrees >= 0})

    return {
        "key": scene["key"],
        "observer": observer,
        "at": iso(scene["at"]),
        "satellites": satellites,
        "inView": sum(satellite["inView"] for satellite in satellites),
    }


def main() -> None:
    timescale = load.timescale(builtin=True)
    scenes = [scene_record(scene, timescale) for scene in SCENES]

    for scene in scenes:
        print(f"{scene['key']}: {scene['inView']} of {len(scene['satellites'])} Satellites in view")
        if scene["inView"] in (0, len(scene["satellites"])):
            raise SystemExit(f"{scene['key']}: every Satellite or none is in view, which no arithmetic could get wrong; move the instant")

    fixture = {
        "generatedBy": "oracle/in-view.py with Skyfield",
        # Every recorded elevation clears the horizon by at least this much,
        # so what the engine must reproduce is a fact about the sky rather
        # than the last digit of either propagator. The elevations are the
        # evidence for the flags, not a number the engine answers: In view
        # is the boolean.
        "edgeMarginDegrees": EDGE_MARGIN_DEGREES,
        "scenes": scenes,
    }
    out = Path(__file__).resolve().parent.parent / "fixtures" / "in-view.json"
    out.write_text(json.dumps(fixture, indent=2) + "\n")
    print(f"wrote {len(scenes)} scenes over {len(SATELLITES)} Satellites to {out}")


if __name__ == "__main__":
    main()
