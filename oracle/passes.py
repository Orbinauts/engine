"""Generate Pass fixtures for the engine from Skyfield.

Run from the engine package with `uv run --project oracle --locked
oracle/passes.py`, or every script in turn with `pnpm fixtures`. For each Observer
and window below, the script asks Skyfield for every Pass of the Satellite (rise,
culmination and set at 0 degrees, no refraction), records the azimuths, the
maximum elevation, whether the Satellite is sunlit at culmination, the Sun's
altitude at the Observer at culmination, the predicted brightness there, and
the Pass's Visible window by the Visible pass rule below, and writes them to
`fixtures/passes.json` with the tolerances the engine tests must meet. It
refuses to write a fixture that does not cover every scenario
`assert_coverage` lists.

The window is found by sampling the four conditions of the rule every second
from rise to set and refining each end of each run of them by bisection, so
that the fixture owes nothing to the engine's own search.
"""

import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from positions import ELEMENTS, iso, load, skyfield_satellite
from skyfield.api import wgs84

TOLERANCE_TIME_SECONDS = 2.0
TOLERANCE_ELEVATION_DEGREES = 0.1
# At the horizon the ISS's azimuth moves by about 0.2 degrees a second, so
# the time tolerance alone allows a few tenths of a degree.
TOLERANCE_AZIMUTH_DEGREES = 0.5
TOLERANCE_SUN_ALTITUDE_DEGREES = 0.05
# The engine and Skyfield differ on the Sun's direction by a fraction of an
# arcsecond and on the range by under a kilometre, which move a magnitude by
# far less than this; the engine also reports it rounded to a tenth.
TOLERANCE_MAGNITUDE = 0.05
# An end of a window is an instant on the arc, not a place on it: where two
# searches put it a moment apart the Satellite has moved on, at up to this rate
# (about 7.3 km/s of relative speed at a range of 350 km, overhead), so a
# place in the sky at that instant is allowed to differ by that much more.
TOLERANCE_SKY_DEGREES_PER_SECOND = 1.2

# The Visible pass rule: the Observer in Night (the Sun at least
# 6 degrees below the horizon, nautical twilight or darker), the Satellite
# Sunlit, at least 10 degrees up, and its predicted brightness magnitude 4.0
# or brighter, all at once. The engine exports the same three numbers; the
# fixture records them under visiblePass.
NIGHT_SUN_ALTITUDE = -6.0
VISIBLE_MIN_ELEVATION = 10.0
VISIBLE_FAINTEST_MAGNITUDE = 4.0

# The brightness model, the one satellite observers and Heavens-Above use
# with a Standard magnitude stated at 1,000 km and half lit:
# m = standard + 5 log10(range / 1000 km) - 2.5 log10(2f), with the
# illuminated fraction f = (1 + cos phase) / 2 floored as Stellarium floors
# it. The engine's brightness.ts computes the same.
STANDARD_MAGNITUDE_RANGE_KM = 1000.0
MIN_ILLUMINATED_FRACTION = 1e-6

# The window is sampled this finely from rise to set, and each end of each run
# is then bisected to this precision.
WINDOW_SAMPLE_SECONDS = 1.0
WINDOW_PRECISION_SECONDS = 0.01

# Each search: an Observer (altitude in metres), the Elements to propagate,
# the Standard magnitude the rule needs (an input to the search, as it is in
# the engine) and the window, chosen so that no Pass straddles either end.
SEARCHES = [
    {
        "key": "madrid-3-days",
        "observer": {"latitude": 40.4168, "longitude": -3.7038, "altitude": 657},
        "elements": "iss-2026-09-19",
        "from": datetime(2026, 9, 19, 14, 0, tzinfo=timezone.utc),
        "to": datetime(2026, 9, 22, 14, 0, tzinfo=timezone.utc),
    },
    {
        # An Observer 3.6 km up: the horizon dips and Passes run longer.
        "key": "la-paz-2-days",
        "observer": {"latitude": -16.4897, "longitude": -68.1193, "altitude": 3640},
        "elements": "iss-2026-09-19",
        "from": datetime(2026, 9, 20, 0, 0, tzinfo=timezone.utc),
        "to": datetime(2026, 9, 22, 0, 0, tzinfo=timezone.utc),
    },
    {
        # High latitude in local summer: at 56 degrees north in late June the
        # Sun only reaches about -11 degrees, so every night Pass is a
        # twilight one, some just brighter than the Visible pass rule allows.
        # The ISS's set is September's, carried back to midsummer: not where
        # the station was that week, but the same Elements through the same
        # arithmetic in both propagators, in the one season that shows this.
        "key": "edinburgh-summer-3-days",
        "observer": {"latitude": 55.9533, "longitude": -3.1883, "altitude": 47},
        "elements": "iss-2026-09-19",
        "from": datetime(2026, 6, 28, 12, 0, tzinfo=timezone.utc),
        "to": datetime(2026, 7, 1, 12, 0, tzinfo=timezone.utc),
    },
    {
        # Tiangong from a city its 41.5 degree orbit passes over often: the
        # station is bright enough to be Visible well before culmination and
        # to disappear into the Earth's shadow high in the sky.
        "key": "sao-paulo-tiangong-3-days",
        "observer": {"latitude": -23.5505, "longitude": -46.6333, "altitude": 760},
        "elements": "tiangong-2026-09-19",
        "from": datetime(2026, 9, 21, 0, 0, tzinfo=timezone.utc),
        "to": datetime(2026, 9, 24, 0, 0, tzinfo=timezone.utc),
    },
    {
        # Hubble from the tropics, the only latitudes its 28.5 degree orbit
        # carries it high over: at magnitude 2.2 it sits near the threshold,
        # so some Passes are Visible and some are excluded by brightness
        # alone, the others' conditions all holding.
        "key": "bangkok-hubble-3-days",
        "observer": {"latitude": 13.7563, "longitude": 100.5018, "altitude": 2},
        "elements": "hubble-2026-09-19",
        "from": datetime(2026, 9, 19, 12, 0, tzinfo=timezone.utc),
        "to": datetime(2026, 9, 22, 12, 0, tzinfo=timezone.utc),
    },
    {
        # Madrid a few days on, at dusk: a Pass that starts in twilight
        # becomes Visible part way through, when the Sun drops past Night.
        "key": "madrid-dusk-2-days",
        "observer": {"latitude": 40.4168, "longitude": -3.7038, "altitude": 657},
        "elements": "iss-2026-09-19",
        "from": datetime(2026, 9, 25, 12, 0, tzinfo=timezone.utc),
        "to": datetime(2026, 9, 27, 12, 0, tzinfo=timezone.utc),
    },
    {
        # Its mirror at dawn: Hubble over Lima, Visible from low in the sky
        # until the Sun climbs past Night while it is still high, so the
        # window closes on the light and not on the horizon.
        "key": "lima-hubble-2-days",
        "observer": {"latitude": -12.0464, "longitude": -77.0428, "altitude": 154},
        "elements": "hubble-2026-09-19",
        "from": datetime(2026, 9, 24, 12, 0, tzinfo=timezone.utc),
        "to": datetime(2026, 9, 26, 12, 0, tzinfo=timezone.utc),
    },
    {
        # An Observer under the ground track in the North Pacific on a day of
        # the season when the ISS only clips the Earth's shadow: it crosses
        # the sky overhead, fades out for four minutes and comes back, so
        # the Pass has two candidate intervals and the longer is the window.
        # No such season falls within weeks of the September set, so the set
        # is carried back to early July, as for Edinburgh above.
        "key": "north-pacific-iss-3-hours",
        "observer": {"latitude": 34.0624, "longitude": -171.4548, "altitude": 0},
        "elements": "iss-2026-09-19",
        "from": datetime(2026, 7, 5, 7, 30, tzinfo=timezone.utc),
        "to": datetime(2026, 7, 5, 10, 30, tzinfo=timezone.utc),
    },
    {
        # The Satellite with a six-digit Catalogue number, on a sun-synchronous
        # orbit: the engine must match Skyfield on it as on the ISS.
        "key": "madrid-saramago-3-days",
        "observer": {"latitude": 40.4168, "longitude": -3.7038, "altitude": 657},
        "elements": "saramago-2026-09-18",
        "from": datetime(2026, 9, 18, 15, 0, tzinfo=timezone.utc),
        "to": datetime(2026, 9, 21, 15, 0, tzinfo=timezone.utc),
    },
    {
        # Chandra on its 63.5-hour deep-space orbit, from the Observer its
        # 57 degree inclination and its slow apogee arc give whole Passes
        # to: two of over twelve hours.
        # A Pass this long is what the search's step bound and the longest
        # Pass bound have to hold for, and nothing in low Earth orbit tests
        # them. At magnitude 3.2 but never nearer than 12,000 km, Chandra is
        # far too faint for a Visible window, so every Pass here carries a
        # brightness and none of them is Visible.
        "key": "nairobi-chandra-3-days",
        "observer": {"latitude": -1.2921, "longitude": 36.8219, "altitude": 1795},
        "elements": "chandra-2026-09-21",
        "from": datetime(2026, 9, 20, 0, 0, tzinfo=timezone.utc),
        "to": datetime(2026, 9, 23, 0, 0, tzinfo=timezone.utc),
    },
    {
        # Terra over Madrid, on the sun-synchronous orbit that carries it
        # over every latitude twice a day, once around half past ten at
        # night. At magnitude 2.7 from about 690 km it is bright enough for
        # the naked eye, only just, on an orbit higher than the crewed
        # stations': its Passes carry a brightness and some of them are
        # Visible.
        "key": "madrid-terra-3-days",
        "observer": {"latitude": 40.4168, "longitude": -3.7038, "altitude": 657},
        "elements": "terra-2026-09-19",
        "from": datetime(2026, 9, 20, 0, 0, tzinfo=timezone.utc),
        "to": datetime(2026, 9, 23, 0, 0, tzinfo=timezone.utc),
    },
    {
        # A GPS satellite on its 12-hour orbit, over one turn of it: the
        # search must find the one Pass such an orbit gives an Observer in
        # that time, and this Observer is close enough under the arc to get
        # a long one, eight and a half hours. The length is what holds the
        # search's longest-Pass bound to an orbit half way to
        # Geostationary. The field has published no Standard magnitude for
        # any of them, so this search states none: the Pass carries no
        # brightness and has no Visible window, and nothing here estimates
        # one, since a guessed magnitude would decide a window on a guess.
        "key": "nairobi-navstar-54-12-hours",
        "observer": {"latitude": -1.2921, "longitude": 36.8219, "altitude": 1795},
        "elements": "navstar-54-2026-09-19",
        "from": datetime(2026, 9, 19, 9, 0, tzinfo=timezone.utc),
        "to": datetime(2026, 9, 19, 21, 0, tzinfo=timezone.utc),
    },
    {
        # Vanguard 1 over an Observer its 34.2 degree orbit carries it well
        # over. Its eccentricity of 0.18 is what no other near-Earth set
        # has: within one Pass the range runs from a few hundred to a few
        # thousand kilometres, so the speed bound the search steps by and
        # the brightness it predicts change several-fold along the arc,
        # and SGP4 rather than SDP4 propagates all of it. At a Standard
        # magnitude of 10.2 it is far too faint to be Visible from
        # anywhere, however close it comes and however the Sun stands, so
        # every Pass here carries a brightness and none of them is
        # Visible: the other half of Chandra's scenario, which is bright
        # at the convention and only ever seen from far away.
        "key": "nairobi-vanguard-1-1-day",
        "observer": {"latitude": -1.2921, "longitude": 36.8219, "altitude": 1795},
        "elements": "vanguard-1-2026-09-19",
        "from": datetime(2026, 9, 19, 14, 0, tzinfo=timezone.utc),
        "to": datetime(2026, 9, 20, 14, 0, tzinfo=timezone.utc),
    },
]

# Standard magnitudes as Heavens-Above publishes them (1,000 km, half lit),
# per Catalogue number.
# Chandra's 3.2 is Heavens-Above's own, and it is bright at that convention:
# what keeps it out of every Visible window is the range, never under 12,000
# km. Saramago has no published value: a 3U CubeSat is a magnitude 7
# satellite at this convention, far below the threshold, and the number is an
# input to the search rather than a claim the fixture makes about that
# Satellite. A GPS satellite is missing from this table on purpose: the field
# has published no value for any of them, so its search states none and its
# Passes carry no brightness.
ISS, TIANGONG, HUBBLE, SARAMAGO, CHANDRA, TERRA, VANGUARD_1 = 25544, 48274, 20580, 100000, 25867, 25994, 5
STANDARD_MAGNITUDES = {ISS: -1.8, TIANGONG: 0.0, HUBBLE: 2.2, SARAMAGO: 7.0, CHANDRA: 3.2, TERRA: 2.7, VANGUARD_1: 10.2}

RISE, CULMINATION, SET = 0, 1, 2


class Sky:
    """The Observer's sky: what the Visible pass rule looks at, at one instant or many."""

    def __init__(self, satellite, topos, planets, standard_magnitude):
        self.satellite = satellite
        self.topos = topos
        self.planets = planets
        self.standard_magnitude = standard_magnitude

    def at(self, t) -> dict:
        elevation, azimuth, distance = (self.satellite - self.topos).at(t).altaz()
        object_position = self.satellite.at(t)
        earth, sun = self.planets["earth"], self.planets["sun"]
        to_sun = earth.at(t).observe(sun).position.km - object_position.position.km
        to_observer = self.topos.at(t).position.km - object_position.position.km
        cos_phase = (to_sun * to_observer).sum(axis=0) / (norm(to_sun) * norm(to_observer))
        illuminated = np.maximum((1 + cos_phase) / 2, MIN_ILLUMINATED_FRACTION)
        return {
            "elevation": elevation.degrees,
            "azimuth": azimuth.degrees,
            "sunlit": object_position.is_sunlit(self.planets),
            "sun_altitude": (earth + self.topos).at(t).observe(sun).apparent().altaz()[0].degrees,
            # None for a Satellite the field has published no Standard
            # magnitude for: nothing here estimates one, so the
            # fourth condition of the rule cannot be judged and no window
            # opens, which is what the engine does with the same absence.
            "magnitude": None
            if self.standard_magnitude is None
            else self.standard_magnitude + 5 * np.log10(distance.km / STANDARD_MAGNITUDE_RANGE_KM) - 2.5 * np.log10(2 * illuminated),
        }


def norm(vectors):
    return np.sqrt((vectors * vectors).sum(axis=0))


def failing(sky_at: dict, i=None) -> str | None:
    """The first condition of the rule that fails, in the order the engine
    reports the reasons; None when all four hold."""
    pick = (lambda values: values) if i is None else (lambda values: values[i])
    if pick(sky_at["elevation"]) < VISIBLE_MIN_ELEVATION:
        return "elevation"
    if not pick(sky_at["sunlit"]):
        return "sunlit"
    if pick(sky_at["sun_altitude"]) >= NIGHT_SUN_ALTITUDE:
        return "night"
    if sky_at["magnitude"] is None or pick(sky_at["magnitude"]) > VISIBLE_FAINTEST_MAGNITUDE:
        return "brightness"
    return None


def runs_of(holds: list[bool]) -> list[tuple[int, int]]:
    """The maximal runs of consecutive True, as inclusive index pairs."""
    runs = []
    start = None
    for i, held in enumerate(holds):
        if held and start is None:
            start = i
        elif not held and start is not None:
            runs.append((start, i - 1))
            start = None
    if start is not None:
        runs.append((start, len(holds) - 1))
    return runs


def window_of(sky: Sky, timescale, rise_t, set_t) -> tuple[dict | None, int, float | None]:
    """The Pass's Visible window, how many runs of the four conditions it had,
    and the brightest magnitude over the instants where the other three hold.

    The conditions are sampled every second from rise to set; each end of each
    run is bisected to a hundredth of a second, and the longest run is the
    window. Rise and set are below 10 degrees, so no run reaches either end of
    the samples."""
    seconds = (set_t.tt - rise_t.tt) * 86400
    steps = max(int(seconds / WINDOW_SAMPLE_SECONDS), 2)
    times = timescale.tt_jd(rise_t.tt + np.linspace(0, seconds, steps + 1) / 86400)
    sky_at = sky.at(times)
    reasons = [failing(sky_at, i) for i in range(steps + 1)]
    runs = runs_of([reason is None for reason in reasons])

    geometry = (
        []
        if sky_at["magnitude"] is None
        else [sky_at["magnitude"][i] for i in range(steps + 1) if reasons[i] is None or reasons[i] == "brightness"]
    )
    geometry_peak = float(min(geometry)) if geometry else None

    if not runs:
        return None, 0, geometry_peak

    def holds(tt) -> bool:
        return failing(sky.at(timescale.tt_jd(tt))) is None

    def bisect(fails_tt: float, holds_tt: float) -> tuple[float, float]:
        while abs(holds_tt - fails_tt) * 86400 > WINDOW_PRECISION_SECONDS:
            middle = (fails_tt + holds_tt) / 2
            if holds(middle):
                holds_tt = middle
            else:
                fails_tt = middle
        return holds_tt, fails_tt

    edges = []
    for start, end in runs:
        opening, before = bisect(times.tt[start - 1], times.tt[start])
        closing, after = bisect(times.tt[end + 1], times.tt[end])
        edges.append((opening, closing, failing(sky.at(timescale.tt_jd(before))), failing(sky.at(timescale.tt_jd(after)))))
    opening, closing, appears_reason, disappears_reason = max(edges, key=lambda edge: edge[1] - edge[0])

    peak_tt = brightest(sky, timescale, opening, closing)
    return (
        {
            "appears": edge_record(sky, timescale, opening, appears_reason),
            "disappears": edge_record(sky, timescale, closing, disappears_reason),
            "peak": {
                "at": iso(timescale.tt_jd(peak_tt).utc_datetime()),
                "magnitude": round(float(sky.at(timescale.tt_jd(peak_tt))["magnitude"]), 4),
            },
        },
        len(runs),
        geometry_peak,
    )


def brightest(sky: Sky, timescale, from_tt: float, to_tt: float) -> float:
    """The instant of least magnitude between two instants: the window
    sampled every second, then the second around the brightest sample
    resampled to a hundredth. Brute force on purpose, so that the fixture
    owes nothing to the engine's search for the same instant."""
    coarse = int(max((to_tt - from_tt) * 86400 / WINDOW_SAMPLE_SECONDS, 2))
    times = timescale.tt_jd(np.linspace(from_tt, to_tt, coarse + 1))
    around = times.tt[int(np.argmin(sky.at(times)["magnitude"]))]
    fine_seconds = WINDOW_SAMPLE_SECONDS
    fine = timescale.tt_jd(
        np.clip(
            around + np.arange(-fine_seconds, fine_seconds, WINDOW_PRECISION_SECONDS) / 86400,
            from_tt,
            to_tt,
        )
    )
    return float(fine.tt[int(np.argmin(sky.at(fine)["magnitude"]))])


def edge_record(sky: Sky, timescale, tt: float, reason: str) -> dict:
    t = timescale.tt_jd(tt)
    sky_at = sky.at(t)
    return {
        "at": iso(t.utc_datetime()),
        "azimuth": round(float(sky_at["azimuth"]), 4),
        "elevation": round(float(sky_at["elevation"]), 4),
        "reason": reason,
    }


def pass_record(sky: Sky, timescale, rise_t, culmination_t, set_t) -> dict:
    """One Pass as the fixture records it: the Skyfield events, the brightness
    at culmination and the Visible window."""
    at_rise, at_culmination, at_set = sky.at(rise_t), sky.at(culmination_t), sky.at(set_t)
    window, candidates, geometry_peak = window_of(sky, timescale, rise_t, set_t)
    return {
        "rise": {"at": iso(rise_t.utc_datetime()), "azimuth": round(float(at_rise["azimuth"]), 4)},
        "culmination": {
            "at": iso(culmination_t.utc_datetime()),
            "azimuth": round(float(at_culmination["azimuth"]), 4),
            "elevation": round(float(at_culmination["elevation"]), 4),
            "sunlit": bool(at_culmination["sunlit"]),
            "sunAltitude": round(float(at_culmination["sun_altitude"]), 4),
            "magnitude": None if at_culmination["magnitude"] is None else round(float(at_culmination["magnitude"]), 4),
        },
        "set": {"at": iso(set_t.utc_datetime()), "azimuth": round(float(at_set["azimuth"]), 4)},
        "window": window,
        "visible": window is not None,
        # Metadata for the scenario guard, not for the engine to reproduce:
        # how many runs of the four conditions the Pass had, and the brightest
        # magnitude over the instants where the other three held (null when
        # they never did), so that a Pass excluded by brightness alone is
        # visible in the fixture.
        "candidateIntervals": candidates,
        "geometryPeakMagnitude": None if geometry_peak is None else round(geometry_peak, 4),
    }


def passes_of(sky: Sky, timescale, key: str, t0, t1) -> list[dict]:
    """Every Pass Skyfield finds over the Observer in the window, in full."""

    def elevation_at(t):
        return (sky.satellite - sky.topos).at(t).altaz()[0].degrees

    for edge in (t0, t1):
        if elevation_at(edge) >= 0:
            raise SystemExit(f"{key}: the Satellite is above the horizon at the edge of the window")

    times, events = sky.satellite.find_events(sky.topos, t0, t1)
    if len(events) % 3 != 0 or list(events) != [RISE, CULMINATION, SET] * (len(events) // 3):
        raise SystemExit(f"{key}: events are not complete rise/culmination/set triples: {list(events)}")

    return [pass_record(sky, timescale, times[i], times[i + 1], times[i + 2]) for i in range(0, len(events), 3)]


def search_sky(search: dict, timescale, planets) -> Sky:
    satellite = skyfield_satellite(search["elements"], timescale)
    observer = search["observer"]
    topos = wgs84.latlon(observer["latitude"], observer["longitude"], elevation_m=observer["altitude"])
    return Sky(satellite, topos, planets, STANDARD_MAGNITUDES.get(ELEMENTS[search["elements"]]["NORAD_CAT_ID"]))


def main() -> None:
    timescale = load.timescale(builtin=True)
    planets = load("de421.bsp")
    searches_out = []

    for search in SEARCHES:
        sky = search_sky(search, timescale, planets)
        passes = passes_of(
            sky,
            timescale,
            search["key"],
            timescale.from_datetime(search["from"]),
            timescale.from_datetime(search["to"]),
        )
        searches_out.append(
            {
                "key": search["key"],
                "elements": search["elements"],
                "observer": search["observer"],
                "standardMagnitude": sky.standard_magnitude,
                "from": iso(search["from"]),
                "to": iso(search["to"]),
                "passes": passes,
            }
        )
        print(f"{search['key']}: {len(passes)} passes, {sum(p['visible'] for p in passes)} visible")

    assert_coverage(searches_out)

    fixture = {
        "generatedBy": "oracle/passes.py with Skyfield",
        "tolerance": {
            "timeSeconds": TOLERANCE_TIME_SECONDS,
            "elevationDegrees": TOLERANCE_ELEVATION_DEGREES,
            "azimuthDegrees": TOLERANCE_AZIMUTH_DEGREES,
            "sunAltitudeDegrees": TOLERANCE_SUN_ALTITUDE_DEGREES,
            "magnitude": TOLERANCE_MAGNITUDE,
            "skyDegreesPerSecond": TOLERANCE_SKY_DEGREES_PER_SECOND,
        },
        "visiblePass": {
            "maxSunAltitude": NIGHT_SUN_ALTITUDE,
            "minElevation": VISIBLE_MIN_ELEVATION,
            "faintestMagnitude": VISIBLE_FAINTEST_MAGNITUDE,
        },
        "elements": ELEMENTS,
        "searches": searches_out,
    }
    out = Path(__file__).resolve().parent.parent / "fixtures" / "passes.json"
    out.write_text(json.dumps(fixture, indent=2) + "\n")
    total = sum(len(search["passes"]) for search in searches_out)
    print(f"wrote {total} passes over {len(searches_out)} searches to {out}")


def hours_of(pass_record: dict) -> float:
    """How long a Pass lasts, from rise to set, in hours."""
    rise, set_ = (datetime.fromisoformat(pass_record[end]["at"]) for end in ("rise", "set"))
    return (set_ - rise).total_seconds() / 3600


def assert_coverage(searches: list[dict]) -> None:
    """The scenarios the fixtures must cover, each a way the engine's Pass search could go wrong."""
    passes = [(search, p) for search in searches for p in search["passes"]]
    scenarios = {
        "a normal night pass": lambda s, p: p["visible"] and p["culmination"]["sunAltitude"] < -12,
        "a daylight pass": lambda s, p: p["culmination"]["sunAltitude"] > 0 and p["culmination"]["elevation"] >= VISIBLE_MIN_ELEVATION,
        "a horizon-hugging pass below 10 degrees": lambda s, p: p["culmination"]["elevation"] < VISIBLE_MIN_ELEVATION,
        "a pass in Earth's shadow at night": lambda s, p: not p["culmination"]["sunlit"] and p["culmination"]["sunAltitude"] < NIGHT_SUN_ALTITUDE,
        "a high-latitude summer twilight Visible pass": lambda s, p: abs(s["observer"]["latitude"]) >= 55 and -12 < p["culmination"]["sunAltitude"] and p["visible"],
        "a civil twilight pass too bright to be a Visible pass": lambda s, p: NIGHT_SUN_ALTITUDE <= p["culmination"]["sunAltitude"] < 0 and p["culmination"]["elevation"] >= VISIBLE_MIN_ELEVATION and p["culmination"]["sunlit"],
        "an Observer at altitude": lambda s, p: s["observer"]["altitude"] >= 1000,
        "a window that ends mid-sky in the Earth's shadow": lambda s, p: p["visible"] and p["window"]["disappears"]["reason"] == "sunlit" and p["window"]["disappears"]["elevation"] >= 20,
        "a window that ends before culmination": lambda s, p: p["visible"] and p["window"]["disappears"]["at"] < p["culmination"]["at"],
        "a Hubble Pass excluded by brightness alone": lambda s, p: not p["visible"]
        and p["geometryPeakMagnitude"] is not None
        and ELEMENTS[s["elements"]]["NORAD_CAT_ID"] == HUBBLE,
        "a Pass with two candidate intervals": lambda s, p: p["candidateIntervals"] >= 2,
        # A Pass of a Satellite on a deep-space orbit, which lasts hours
        # rather than minutes: what the search's step bound and the longest
        # Pass bound have to hold for.
        "a Pass lasting over ten hours": lambda s, p: hours_of(p) > 10,
        # The same Satellite seen at its faintest and its brightest: at
        # magnitude 3.2 but never within 12,000 km, no geometry the orbit
        # allows brings Chandra to the threshold.
        "a Pass of a Satellite too far to be Visible at any brightness": lambda s, p: not p["visible"]
        and p["geometryPeakMagnitude"] is not None
        and ELEMENTS[s["elements"]]["NORAD_CAT_ID"] == CHANDRA,
        # A Satellite of a Constellation: a 12-hour navigation orbit, and a
        # Satellite the field publishes no Standard magnitude for, so the Pass
        # carries no brightness at all rather than one too faint to see.
        "a Pass on a 12-hour navigation orbit": lambda s, p: 11.9 < 24 / ELEMENTS[s["elements"]]["MEAN_MOTION"] < 12.1,
        # An eccentric near-Earth orbit: the range from the Observer runs
        # from a few hundred to a few thousand kilometres within one Pass,
        # which no other SGP4 set does, and the Satellite is too faint to be
        # Visible at any of it even though its brightness is published.
        "a Pass on an eccentric near-Earth orbit": lambda s, p: ELEMENTS[s["elements"]]["ECCENTRICITY"] > 0.1 and 24 / ELEMENTS[s["elements"]]["MEAN_MOTION"] < 4,
        "a Pass of a Satellite too faint to be Visible from any range": lambda s, p: not p["visible"]
        and p["geometryPeakMagnitude"] is not None
        and ELEMENTS[s["elements"]]["NORAD_CAT_ID"] == VANGUARD_1,
        "a Pass of a Satellite with no Standard magnitude": lambda s, p: s["standardMagnitude"] is None,
    }
    for name, matches in scenarios.items():
        count = sum(1 for search, p in passes if matches(search, p))
        print(f"{count:3d} passes: {name}")
        if count == 0:
            raise SystemExit(f"no fixture pass covers {name}; widen a window or add an Observer")

    visible_satellites = {ELEMENTS[search["elements"]]["NORAD_CAT_ID"] for search, p in passes if p["visible"]}
    for catalogue_number in (ISS, TIANGONG, HUBBLE, TERRA):
        if catalogue_number not in visible_satellites:
            raise SystemExit(f"no fixture Visible pass for Satellite {catalogue_number}; widen a window or add an Observer")
    print(f"{len(visible_satellites):3d} Satellites with a Visible pass")

    # Each of the four conditions must be seen beginning or ending a window,
    # so that every reason the engine can report is one Skyfield agreed on.
    reasons = {p["window"][end]["reason"] for _, p in passes if p["visible"] for end in ("appears", "disappears")}
    print(f"    reasons: {', '.join(sorted(reasons))}")
    for reason in ("elevation", "sunlit", "night", "brightness"):
        if reason not in reasons:
            raise SystemExit(f"no fixture window begins or ends with the reason {reason}; widen a window or add an Observer")


if __name__ == "__main__":
    main()
