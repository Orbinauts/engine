"""Generate an Ephemeris fixture for the engine from Skyfield.

Run from the engine package with `uv run --project oracle --locked
oracle/ephemeris.py`, or every script in turn with `pnpm fixtures`. The script
writes `fixtures/ephemeris.oem.txt`, a simulated ISS Ephemeris in the
CCSDS OEM format NASA publishes (state vectors in the J2000 frame, four
minutes apart, finer around a reboost), and `fixtures/ephemeris.json`, the
Positions Skyfield gives at chosen instants, with the tolerance the engine
must meet when it interpolates the vectors and rotates them into the
Earth-fixed frame.

The vectors are Skyfield's SGP4 states in the GCRS frame (J2000 to well
under a metre at this altitude): the ISS Elements of 2026-09-19 until the
simulated reboost, then Elements derived from them by changing OMM fields,
the mean motion lowered, so that the Ephemeris and the Elements of before
the reboost diverge afterwards. The expected Positions are propagated directly, never
interpolated, so the fixture is independent of the engine's interpolation.
"""

import json
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path

from passes import STANDARD_MAGNITUDES, Sky, passes_of
from positions import ELEMENTS, iso, load, skyfield_satellite
from skyfield.api import EarthSatellite, wgs84

TOLERANCE_KM = 1.0
# The Elements and the Ephemeris must be at least this far apart at every
# instant marked as after the reboost, or the scenario proves nothing.
MIN_DIVERGENCE_KM = 20.0
# The stitched Ephemeris may jump by at most this much at the reboost.
MAX_REBOOST_JUMP_KM = 10.0

ELEMENTS_KEY = "iss-2026-09-19"
ISSUED_AT = datetime(2026, 9, 19, 15, 15, 51, 545000, tzinfo=timezone.utc)
COVERS_FROM = datetime(2026, 9, 19, 12, 0, tzinfo=timezone.utc)
# An hour past the last Pass search window, so that a Pass in progress at
# its end still lies within the vectors.
COVERS_TO = datetime(2026, 9, 21, 13, 0, tzinfo=timezone.utc)
STEP = timedelta(minutes=4)

REBOOST_AT = datetime(2026, 9, 20, 12, 0, tzinfo=timezone.utc)
# Around the reboost the vectors come every minute, as NASA's do around a burn.
REBOOST_FINE_STEP = timedelta(minutes=1)
REBOOST_FINE_SPAN = timedelta(minutes=10)
# The reboost lowers the mean motion by this many revolutions per day,
# raising the orbit by about 1.4 km; a day later the Satellites are some
# 100 km apart along track.
REBOOST_MEAN_MOTION_DROP = 0.005

# Instants at which the expected Position is recorded: on and off the
# four-minute grid, before and after the reboost, and at both edges.
INSTANTS = [
    COVERS_FROM,
    datetime(2026, 9, 19, 12, 17, 30, tzinfo=timezone.utc),
    datetime(2026, 9, 19, 15, 0, tzinfo=timezone.utc),
    datetime(2026, 9, 20, 8, 0, tzinfo=timezone.utc),
    datetime(2026, 9, 20, 8, 1, 23, 456000, tzinfo=timezone.utc),
    datetime(2026, 9, 20, 11, 49, tzinfo=timezone.utc),
    datetime(2026, 9, 20, 15, 0, tzinfo=timezone.utc),
    datetime(2026, 9, 21, 11, 0, tzinfo=timezone.utc),
    datetime(2026, 9, 21, 12, 0, tzinfo=timezone.utc),
    COVERS_TO,
]
# Instants the Ephemeris does not cover.
OUTSIDE = [COVERS_FROM - timedelta(milliseconds=1), COVERS_TO + timedelta(milliseconds=1)]

# Passes over this Observer after the reboost, from the reboosted orbit: the Pass times the Ephemeris must give, and the ones the
# stale Elements would give instead. The search starts a few hours after the
# reboost, once the two orbits have drifted apart by more than a Pass time
# can hide: the Passes of that afternoon are only seconds apart.
PASS_OBSERVER = {"latitude": 40.4168, "longitude": -3.7038, "altitude": 657}
PASS_FROM = REBOOST_AT + timedelta(hours=5)
PASS_TO = datetime(2026, 9, 21, 12, 0, tzinfo=timezone.utc)
# The Pass times from the Elements and from the Ephemeris must differ by
# at least this much, more than twice the time tolerance, or the scenario
# proves nothing.
MIN_PASS_DIVERGENCE_SECONDS = 5.0


def oem_time(moment: datetime) -> str:
    """NASA writes UTC without a zone designator."""
    return iso(moment)[:-1]


def derived_elements(omm: dict, satellite: EarthSatellite, epoch: datetime, mean_motion_drop: float) -> dict:
    """The OMM object with the given epoch, the angles continuing the secular
    drift of the originals, and the mean motion lowered: the Satellite after a
    reboost."""
    model = satellite.model
    minutes = (epoch - satellite.epoch.utc_datetime()).total_seconds() / 60
    degrees = lambda radians: round(math.degrees(radians) % 360, 4)
    return {
        **omm,
        "EPOCH": epoch.strftime("%Y-%m-%dT%H:%M:%S.%f"),
        "RA_OF_ASC_NODE": degrees(model.nodeo + model.nodedot * minutes),
        "ARG_OF_PERICENTER": degrees(model.argpo + model.argpdot * minutes),
        "MEAN_ANOMALY": degrees(model.mo + model.mdot * minutes),
        "MEAN_MOTION": round(model.no_kozai * 1440 / (2 * math.pi) - mean_motion_drop, 8),
    }


def vector_instants() -> list[datetime]:
    instants = []
    moment = COVERS_FROM
    while moment <= COVERS_TO:
        instants.append(moment)
        moment += STEP
    fine = REBOOST_AT - REBOOST_FINE_SPAN
    while fine <= REBOOST_AT + REBOOST_FINE_SPAN:
        instants.append(fine)
        fine += REBOOST_FINE_STEP
    return sorted(set(instants))


def find_passes(satellite: EarthSatellite, timescale, planets, observer: dict, start: datetime, end: datetime) -> list[dict]:
    """Every Pass Skyfield finds over the Observer, as `oracle/passes.py` records them, window and brightness included."""
    topos = wgs84.latlon(observer["latitude"], observer["longitude"], elevation_m=observer["altitude"])
    sky = Sky(satellite, topos, planets, STANDARD_MAGNITUDES[satellite.model.satnum])
    return passes_of(sky, timescale, "ephemeris", timescale.from_datetime(start), timescale.from_datetime(end))


def main() -> None:
    timescale = load.timescale(builtin=True)
    planets = load("de421.bsp")
    before = skyfield_satellite(ELEMENTS_KEY, timescale)
    after_omm = derived_elements(ELEMENTS[ELEMENTS_KEY], before, REBOOST_AT, REBOOST_MEAN_MOTION_DROP)
    after = EarthSatellite.from_omm(timescale, after_omm)

    def satellite_at(moment: datetime) -> EarthSatellite:
        return after if moment >= REBOOST_AT else before

    def state(moment: datetime):
        return satellite_at(moment).at(timescale.from_datetime(moment))

    def position_of(geocentric) -> dict:
        point = wgs84.geographic_position_of(geocentric)
        return {
            "latitude": round(point.latitude.degrees, 6),
            "longitude": round(point.longitude.degrees, 6),
            "altitude": round(point.elevation.km, 4),
        }

    jump = float(before.at(timescale.from_datetime(REBOOST_AT)).distance().km - after.at(timescale.from_datetime(REBOOST_AT)).distance().km)
    separation = (before - after).at(timescale.from_datetime(REBOOST_AT)).distance().km
    if separation > MAX_REBOOST_JUMP_KM:
        raise SystemExit(f"the Ephemeris jumps {separation:.1f} km at the reboost")

    lines = [
        "CCSDS_OEM_VERS = 2.0",
        f"CREATION_DATE  = {oem_time(ISSUED_AT)}",
        "ORIGINATOR     = ORBINAUTS ENGINE ORACLE",
        "",
        "META_START",
        "OBJECT_NAME          = ISS",
        "OBJECT_ID            = 1998-067-A",
        "CENTER_NAME          = Earth",
        "REF_FRAME            = EME2000",
        "TIME_SYSTEM          = UTC",
        f"START_TIME           = {oem_time(COVERS_FROM)}",
        f"USEABLE_START_TIME   = {oem_time(COVERS_FROM)}",
        f"USEABLE_STOP_TIME    = {oem_time(COVERS_TO)}",
        f"STOP_TIME            = {oem_time(COVERS_TO)}",
        "META_STOP",
        "",
        "COMMENT Simulated data: every vector here was computed by oracle/ephemeris.py with Skyfield from published Elements and a made-up reboost.",
        "COMMENT It follows the layout of NASA's ISS Ephemeris file but is not NASA's and describes no real trajectory.",
        "COMMENT Units are in kg and m^2",
        "COMMENT MASS=468853.80",
        "COMMENT DRAG_AREA=1138.30",
        "COMMENT DRAG_COEFF=1.80",
        "COMMENT Begin sequence of events",
        "COMMENT TRAJECTORY EVENT SUMMARY:",
        "COMMENT ",
        "COMMENT |       EVENT        |       TIG        | ORB |   DV    |   HA    |   HP    |",
        "COMMENT |                    |       GMT        |     |   M/S   |   KM    |   KM    |",
        "COMMENT =============================================================================",
        f"COMMENT  Simulated_Reboost    {REBOOST_AT.strftime('%j:%H:%M:%S.000')}             0.8     424.6     416.5",
        "COMMENT =============================================================================",
        "COMMENT End sequence of events",
    ]
    instants = vector_instants()
    for moment in instants:
        geocentric = state(moment)
        x, y, z = geocentric.position.km
        vx, vy, vz = geocentric.velocity.km_per_s
        lines.append(f"{oem_time(moment)} {x:.9f} {y:.9f} {z:.9f} {vx:.12f} {vy:.12f} {vz:.12f}")

    positions = []
    for moment in INSTANTS:
        expected = position_of(state(moment))
        from_elements = position_of(before.at(timescale.from_datetime(moment)))
        divergence = float((before - satellite_at(moment)).at(timescale.from_datetime(moment)).distance().km)
        after_reboost = moment >= REBOOST_AT
        if after_reboost and divergence < MIN_DIVERGENCE_KM:
            raise SystemExit(f"at {iso(moment)} the Elements and the Ephemeris are only {divergence:.1f} km apart")
        positions.append(
            {
                "at": iso(moment),
                **expected,
                "afterReboost": after_reboost,
                "fromElements": from_elements,
                "divergenceKm": round(divergence, 3),
            }
        )

    passes = find_passes(after, timescale, planets, PASS_OBSERVER, PASS_FROM, PASS_TO)
    from_elements = find_passes(before, timescale, planets, PASS_OBSERVER, PASS_FROM, PASS_TO)
    if len(passes) != len(from_elements):
        raise SystemExit(f"the Elements give {len(from_elements)} Passes after the reboost, the Ephemeris {len(passes)}")
    for expected, stale in zip(passes, from_elements):
        apart = abs((datetime.fromisoformat(expected["rise"]["at"]) - datetime.fromisoformat(stale["rise"]["at"])).total_seconds())
        if apart < MIN_PASS_DIVERGENCE_SECONDS:
            raise SystemExit(f"the Pass rising at {expected['rise']['at']} is only {apart:.1f} s from the one the Elements give")

    fixtures = Path(__file__).resolve().parent.parent / "fixtures"
    oem = fixtures / "ephemeris.oem.txt"
    oem.write_text("\n".join(lines) + "\n")
    fixture = {
        "generatedBy": "oracle/ephemeris.py with Skyfield",
        "tolerance": {
            "positionKm": TOLERANCE_KM,
            "minDivergenceKm": MIN_DIVERGENCE_KM,
            "minPassDivergenceSeconds": MIN_PASS_DIVERGENCE_SECONDS,
        },
        "file": oem.name,
        "elements": ELEMENTS_KEY,
        "issuedAt": iso(ISSUED_AT),
        "covers": {"from": iso(COVERS_FROM), "to": iso(COVERS_TO)},
        "vectors": len(instants),
        "reboost": {"at": iso(REBOOST_AT), "elements": after_omm, "jumpKm": round(separation, 3)},
        "positions": positions,
        "outside": [iso(moment) for moment in OUTSIDE],
        "passes": {
            "observer": PASS_OBSERVER,
            "from": iso(PASS_FROM),
            "to": iso(PASS_TO),
            "passes": passes,
            "fromElements": [pass_["rise"]["at"] for pass_ in from_elements],
        },
    }
    out = fixtures / "ephemeris.json"
    out.write_text(json.dumps(fixture, indent=2) + "\n")
    print(f"wrote {fixture['vectors']} vectors to {oem} (jump {separation:.3f} km at the reboost, altitude change {jump:+.3f} km)")
    print(f"wrote {len(positions)} positions and {len(passes)} passes after the reboost to {out}")


if __name__ == "__main__":
    main()
