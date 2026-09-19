"""Generate Position fixtures for the engine from Skyfield.

Run from the engine package with `uv run --project oracle --locked
oracle/positions.py`, or every script in turn with `pnpm fixtures`. The script
propagates published Elements at chosen instants and writes the Positions,
speeds, Courses, orbital periods, Footprint rings and subsolar points
Skyfield computes to `fixtures/positions.json`, with the tolerances the engine tests
must meet. Each Satellite's Skyfield model is built from the OMM fields with
Skyfield's OMM constructor, and the same OMM object is written into the
fixture, so the oracle and the engine read one representation: the OMM,
which carries catalogue numbers of any width, where the two-line format runs
out at five digits. Python is a development-time oracle only. The JPL ephemeris the Sun needs is cached
under ~/.cache/skyfield.
"""

import json
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path

from skyfield.api import EarthSatellite, Loader, wgs84

load = Loader(Path.home() / ".cache" / "skyfield")

TOLERANCE_KM = 1.0
TOLERANCE_SPEED_KM_PER_SECOND = 0.001
TOLERANCE_PERIOD_SECONDS = 0.01
TOLERANCE_SUBSOLAR_DEGREES = 0.01
# The engine draws the Footprint on a sphere; Skyfield finds the horizon on
# the WGS84 ellipsoid. The ring points differ by up to about 6 km, the
# radius of the ring being some 2200 km.
TOLERANCE_FOOTPRINT_KM = 10.0
# A Course is usually told as one of eight compass points, each 45 degrees
# wide, so this is a thousandth of what a word can carry; the engine meets it
# with room to spare.
TOLERANCE_COURSE_DEGREES = 0.05
# The orbit's phase is the mean anomaly carried forward at the mean
# motion, both read off the OMM by two libraries: what can differ is the
# reading of the epoch and the units, and a thousandth of a degree is a
# hundredth of a second of orbit.
TOLERANCE_MEAN_ANOMALY_DEGREES = 0.001
# The apsides are SGP4's own, from the record both libraries initialise
# from the same fields with the same constants; a metre is floating point.
TOLERANCE_APSIDES_KM = 0.001
# The Earth's radius SGP4 runs on (WGS72), which its record measures the
# apsides in and which satellite.js multiplies by too: not WGS84's.
SGP4_EARTH_RADIUS_KM = 6378.135

# The Course is the direction the point beneath the Satellite
# moves over the ground, so it is measured here as exactly that: the
# sub-point Skyfield puts on the WGS84 ellipsoid this long before and after
# the instant, and the direction from the one to the other.
COURSE_HALF_STEP = timedelta(seconds=1)
# A sub-point that moves slower than this over the ground stands, and has
# no Course: it is the drift of a Geostationary Satellite round the small
# figure it keeps to, at most 6 metres a second for any fixture set over two
# days from its epoch, where the slowest sub-point that crosses the sky,
# Chandra's near apogee, never moves at under 107 (BeiDou 3 IGSO-1's, at
# the tips of its figure of eight, under 222).
STANDING_KM_PER_SECOND = 0.05
WGS84_EQUATORIAL_KM = 6378.137
WGS84_FLATTENING = 1 / 298.257223563

# The Footprint ring is searched out to this angular distance from the
# sub-point: beyond the horizon of a Geostationary Satellite, which stands
# 1.419 radians of Earth from the edge of what it sees, and so beyond every
# Satellite's.
FOOTPRINT_SEARCH_RADIANS = 1.6
FOOTPRINT_SEARCH_STEPS = 60

# Instants at which the subsolar point is recorded: the 2026 March equinox,
# the June solstice, and two ordinary instants near the 2026 Elements.
SUBSOLAR_INSTANTS = [
    datetime(2026, 3, 20, 14, 46, tzinfo=timezone.utc),
    datetime(2026, 6, 21, 8, 24, tzinfo=timezone.utc),
    datetime(2026, 9, 19, 7, 17, 41, 839000, tzinfo=timezone.utc),
    datetime(2026, 12, 25, 0, 0, tzinfo=timezone.utc),
]

# The Footprint ring is recorded at this offset from each epoch, with this many points.
FOOTPRINT_OFFSET = timedelta(hours=1)
FOOTPRINT_POINTS = 12

# Published Elements: the CCSDS OMM fields the engine keeps, in the standard's
# order. Every set but two is CelesTrak's, taken on 2026-09-19 as CelesTrak
# serves it in JSON (celestrak.org/NORAD/elements/gp.php?CATNR=<number>&FORMAT=json),
# the newest set of that day for each Satellite and copied here field for
# field; the key names the Satellite and the date of the set's epoch.
#
# The ISS, the station, is the Satellite most tests ask about, and its set is
# the one the Ephemeris fixture starts from; Tiangong, the other station, and
# Hubble, the telescope, are the two others whose Standard magnitudes the
# Visible window rule needs. Saramago, a Portuguese CubeSat on a
# sun-synchronous orbit, carries a six-digit Catalogue number (100000, the
# first assigned). Four Satellites of a sidereal day's period are what the
# Geostationary rule is proved on (oracle/geostationary.py): GOES-19,
# Meteosat-12 and Hispasat 30W-6, which stand over one longitude, and BeiDou-3
# IGSO-1, geosynchronous but inclined by 59 degrees, which does not. Chandra's
# 63.5-hour orbit runs from a perigee of about 12,000 km to an apogee of about
# 137,000 km, so that its Passes last hours and the Pass search's bounds are
# proved on an orbit far outside low Earth orbit. Terra and Landsat 9, the two
# earth-observers, cross the sky on sun-synchronous orbits at about 690 and
# 700 km that carry them over every latitude: Terra's published magnitude
# makes it a Naked-eye Satellite, and for Landsat 9 the field publishes none.
# Vanguard 1, the oldest Satellite in orbit, flies a 34 degree orbit of 132.6
# minutes whose eccentricity of 0.18 carries it from about 650 km to about
# 3,800 km, so its range from an Observer changes several-fold within one
# Pass; SGP4 propagates it, the period being under the 225 minutes that
# choose SDP4, and no other near-Earth set is anything but nearly circular.
# Four GPS and two Galileo Satellites, of the two Constellations, are what
# the In view count is proved on (oracle/in-view.py) and one of them a Pass
# search (oracle/passes.py); their orbits are deep-space ones, propagated by
# SDP4 rather than SGP4, which no low Earth set exercises. Searched by
# Catalogue number, CelesTrak names a GPS Satellite NAVSTAR and its USA
# number, as its group files do not ("GPS BIIR-11 (PRN 19)"); the Engine
# answers with the name the Elements carry.
#
# The two older ISS sets are the examples of the two-line format that others
# print: 2008-09-20 is the set Wikipedia's "Two-line element set" article
# shows, and 2014-01-20 the set Skyfield's documentation loads in its "Earth
# Satellites" chapter, both as read on 2026-09-19. Their two lines are quoted
# beside each, and the OMM fields are those lines' own.
OMM_FIELDS = (
    "OBJECT_NAME",
    "OBJECT_ID",
    "EPOCH",
    "MEAN_MOTION",
    "ECCENTRICITY",
    "INCLINATION",
    "RA_OF_ASC_NODE",
    "ARG_OF_PERICENTER",
    "MEAN_ANOMALY",
    "EPHEMERIS_TYPE",
    "CLASSIFICATION_TYPE",
    "NORAD_CAT_ID",
    "ELEMENT_SET_NO",
    "REV_AT_EPOCH",
    "BSTAR",
    "MEAN_MOTION_DOT",
    "MEAN_MOTION_DDOT",
)
ISS = {"OBJECT_NAME": "ISS (ZARYA)", "OBJECT_ID": "1998-067A", "EPHEMERIS_TYPE": 0, "CLASSIFICATION_TYPE": "U", "NORAD_CAT_ID": 25544}
PUBLISHED = {
    # Wikipedia, "Two-line element set":
    # 1 25544U 98067A   08264.51782528 -.00002182  00000-0 -11606-4 0  2927
    # 2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.72125391563537
    "iss-2008-09-20": {
        **ISS,
        "EPOCH": "2008-09-20T12:25:40.104192",
        "MEAN_MOTION": 15.72125391,
        "ECCENTRICITY": 0.0006703,
        "INCLINATION": 51.6416,
        "RA_OF_ASC_NODE": 247.4627,
        "ARG_OF_PERICENTER": 130.536,
        "MEAN_ANOMALY": 325.0288,
        "ELEMENT_SET_NO": 292,
        "REV_AT_EPOCH": 56353,
        "BSTAR": -0.000011606,
        "MEAN_MOTION_DOT": -0.00002182,
        "MEAN_MOTION_DDOT": 0.0,
    },
    # Skyfield's documentation, "Earth Satellites":
    # 1 25544U 98067A   14020.93268519  .00009878  00000-0  18200-3 0  5082
    # 2 25544  51.6498 109.4756 0003572  55.9686 274.8005 15.49815350868473
    "iss-2014-01-20": {
        **ISS,
        "EPOCH": "2014-01-20T22:23:04.000416",
        "MEAN_MOTION": 15.4981535,
        "ECCENTRICITY": 0.0003572,
        "INCLINATION": 51.6498,
        "RA_OF_ASC_NODE": 109.4756,
        "ARG_OF_PERICENTER": 55.9686,
        "MEAN_ANOMALY": 274.8005,
        "ELEMENT_SET_NO": 508,
        "REV_AT_EPOCH": 86847,
        "BSTAR": 0.000182,
        "MEAN_MOTION_DOT": 0.00009878,
        "MEAN_MOTION_DDOT": 0.0,
    },
    # CelesTrak, 2026-09-19.
    "iss-2026-09-19": {
        "OBJECT_NAME": "ISS (ZARYA)",
        "OBJECT_ID": "1998-067A",
        "EPOCH": "2026-09-19T07:17:41.839008",
        "MEAN_MOTION": 15.49175317,
        "ECCENTRICITY": 0.0004815,
        "INCLINATION": 51.6308,
        "RA_OF_ASC_NODE": 194.2901,
        "ARG_OF_PERICENTER": 157.3949,
        "MEAN_ANOMALY": 202.7252,
        "EPHEMERIS_TYPE": 0,
        "CLASSIFICATION_TYPE": "U",
        "NORAD_CAT_ID": 25544,
        "ELEMENT_SET_NO": 999,
        "REV_AT_EPOCH": 58634,
        "BSTAR": 0.00012007,
        "MEAN_MOTION_DOT": 0.00006211,
        "MEAN_MOTION_DDOT": 0.0,
    },
    "tiangong-2026-09-19": {
        "OBJECT_NAME": "CSS (TIANHE)",
        "OBJECT_ID": "2021-035A",
        "EPOCH": "2026-09-19T12:20:12.560064",
        "MEAN_MOTION": 15.6010613,
        "ECCENTRICITY": 0.0002588,
        "INCLINATION": 41.4679,
        "RA_OF_ASC_NODE": 109.276,
        "ARG_OF_PERICENTER": 291.3321,
        "MEAN_ANOMALY": 68.7241,
        "EPHEMERIS_TYPE": 0,
        "CLASSIFICATION_TYPE": "U",
        "NORAD_CAT_ID": 48274,
        "ELEMENT_SET_NO": 999,
        "REV_AT_EPOCH": 30789,
        "BSTAR": 0.00019468,
        "MEAN_MOTION_DOT": 0.00015955,
        "MEAN_MOTION_DDOT": 0.0,
    },
    "hubble-2026-09-19": {
        "OBJECT_NAME": "HST",
        "OBJECT_ID": "1990-037B",
        "EPOCH": "2026-09-19T01:27:10.034784",
        "MEAN_MOTION": 15.31690777,
        "ECCENTRICITY": 0.00019301,
        "INCLINATION": 28.4729,
        "RA_OF_ASC_NODE": 158.5121,
        "ARG_OF_PERICENTER": 104.6713,
        "MEAN_ANOMALY": 255.4097,
        "EPHEMERIS_TYPE": 0,
        "CLASSIFICATION_TYPE": "U",
        "NORAD_CAT_ID": 20580,
        "ELEMENT_SET_NO": 999,
        "REV_AT_EPOCH": 80297,
        "BSTAR": 0.00015074651,
        "MEAN_MOTION_DOT": 0.00004982,
        "MEAN_MOTION_DDOT": 0.0,
    },
    "saramago-2026-09-18": {
        "OBJECT_NAME": "SARAMAGO",
        "OBJECT_ID": "2026-067CY",
        "EPOCH": "2026-09-18T02:32:43.287648",
        "MEAN_MOTION": 15.213839,
        "ECCENTRICITY": 0.0009299,
        "INCLINATION": 97.4681,
        "RA_OF_ASC_NODE": 218.6928,
        "ARG_OF_PERICENTER": 52.7448,
        "MEAN_ANOMALY": 307.4635,
        "EPHEMERIS_TYPE": 0,
        "CLASSIFICATION_TYPE": "U",
        "NORAD_CAT_ID": 100000,
        "ELEMENT_SET_NO": 999,
        "REV_AT_EPOCH": 2582,
        "BSTAR": 0.0003754272,
        "MEAN_MOTION_DOT": 0.00008361,
        "MEAN_MOTION_DDOT": 0.0,
    },
    "goes-19-2026-09-19": {
        "OBJECT_NAME": "GOES 19",
        "OBJECT_ID": "2024-119A",
        "EPOCH": "2026-09-19T11:28:53.488704",
        "MEAN_MOTION": 1.00271803,
        "ECCENTRICITY": 0.000032,
        "INCLINATION": 0.0382,
        "RA_OF_ASC_NODE": 6.0328,
        "ARG_OF_PERICENTER": 244.821,
        "MEAN_ANOMALY": 204.5735,
        "EPHEMERIS_TYPE": 0,
        "CLASSIFICATION_TYPE": "U",
        "NORAD_CAT_ID": 60133,
        "ELEMENT_SET_NO": 999,
        "REV_AT_EPOCH": 791,
        "BSTAR": 0.0,
        "MEAN_MOTION_DOT": -0.00000253,
        "MEAN_MOTION_DDOT": 0.0,
    },
    "meteosat-12-2026-09-19": {
        "OBJECT_NAME": "METEOSAT-12 (MTG-I1)",
        "OBJECT_ID": "2022-170C",
        "EPOCH": "2026-09-19T08:24:33.664032",
        "MEAN_MOTION": 1.00272579,
        "ECCENTRICITY": 0.0003876,
        "INCLINATION": 0.7354,
        "RA_OF_ASC_NODE": 19.8294,
        "ARG_OF_PERICENTER": 93.5797,
        "MEAN_ANOMALY": 10.5329,
        "EPHEMERIS_TYPE": 0,
        "CLASSIFICATION_TYPE": "U",
        "NORAD_CAT_ID": 54743,
        "ELEMENT_SET_NO": 999,
        "REV_AT_EPOCH": 1392,
        "BSTAR": 0.0,
        "MEAN_MOTION_DOT": -0.00000012,
        "MEAN_MOTION_DDOT": 0.0,
    },
    "hispasat-30w-6-2026-09-19": {
        "OBJECT_NAME": "HISPASAT 30W-6",
        "OBJECT_ID": "2018-023A",
        "EPOCH": "2026-09-19T08:16:34.430016",
        "MEAN_MOTION": 1.00272764,
        "ECCENTRICITY": 0.0003284,
        "INCLINATION": 0.0464,
        "RA_OF_ASC_NODE": 36.8188,
        "ARG_OF_PERICENTER": 104.3932,
        "MEAN_ANOMALY": 311.1958,
        "EPHEMERIS_TYPE": 0,
        "CLASSIFICATION_TYPE": "U",
        "NORAD_CAT_ID": 43228,
        "ELEMENT_SET_NO": 999,
        "REV_AT_EPOCH": 3135,
        "BSTAR": 0.0,
        "MEAN_MOTION_DOT": -0.0000022,
        "MEAN_MOTION_DDOT": 0.0,
    },
    "beidou-3-igso-1-2026-09-18": {
        "OBJECT_NAME": "BEIDOU-3 IGSO-1",
        "OBJECT_ID": "2019-023A",
        "EPOCH": "2026-09-18T20:29:56.779296",
        "MEAN_MOTION": 1.0026491,
        "ECCENTRICITY": 0.0027931,
        "INCLINATION": 58.8295,
        "RA_OF_ASC_NODE": 36.6926,
        "ARG_OF_PERICENTER": 223.2382,
        "MEAN_ANOMALY": 163.9271,
        "EPHEMERIS_TYPE": 0,
        "CLASSIFICATION_TYPE": "U",
        "NORAD_CAT_ID": 44204,
        "ELEMENT_SET_NO": 999,
        "REV_AT_EPOCH": 815,
        "BSTAR": 0.0,
        "MEAN_MOTION_DOT": -0.00000196,
        "MEAN_MOTION_DDOT": 0.0,
    },
    "chandra-2026-09-21": {
        "OBJECT_NAME": "CXO",
        "OBJECT_ID": "1999-040B",
        "EPOCH": "2026-09-21T13:52:52.584096",
        "MEAN_MOTION": 0.37796833,
        "ECCENTRICITY": 0.7687429,
        "INCLINATION": 57.4713,
        "RA_OF_ASC_NODE": 114.184,
        "ARG_OF_PERICENTER": 309.3021,
        "MEAN_ANOMALY": 0.4302,
        "EPHEMERIS_TYPE": 0,
        "CLASSIFICATION_TYPE": "U",
        "NORAD_CAT_ID": 25867,
        "ELEMENT_SET_NO": 999,
        "REV_AT_EPOCH": 1768,
        "BSTAR": 0.0,
        "MEAN_MOTION_DOT": 0.00000964,
        "MEAN_MOTION_DDOT": 0.0,
    },
    "terra-2026-09-19": {
        "OBJECT_NAME": "TERRA",
        "OBJECT_ID": "1999-068A",
        "EPOCH": "2026-09-19T10:50:49.134048",
        "MEAN_MOTION": 14.61162301,
        "ECCENTRICITY": 0.0001054,
        "INCLINATION": 97.9362,
        "RA_OF_ASC_NODE": 308.218,
        "ARG_OF_PERICENTER": 319.6767,
        "MEAN_ANOMALY": 97.6592,
        "EPHEMERIS_TYPE": 0,
        "CLASSIFICATION_TYPE": "U",
        "NORAD_CAT_ID": 25994,
        "ELEMENT_SET_NO": 999,
        "REV_AT_EPOCH": 42337,
        "BSTAR": 0.000047955,
        "MEAN_MOTION_DOT": 0.00000192,
        "MEAN_MOTION_DDOT": 0.0,
    },
    "landsat-9-2026-09-19": {
        "OBJECT_NAME": "LANDSAT 9",
        "OBJECT_ID": "2021-088A",
        "EPOCH": "2026-09-19T11:31:31.071072",
        "MEAN_MOTION": 14.57099656,
        "ECCENTRICITY": 0.0001512,
        "INCLINATION": 98.22,
        "RA_OF_ASC_NODE": 331.474,
        "ARG_OF_PERICENTER": 95.3717,
        "MEAN_ANOMALY": 264.7653,
        "EPHEMERIS_TYPE": 0,
        "CLASSIFICATION_TYPE": "U",
        "NORAD_CAT_ID": 49260,
        "ELEMENT_SET_NO": 999,
        "REV_AT_EPOCH": 26473,
        "BSTAR": 0.000050145,
        "MEAN_MOTION_DOT": 0.0000018,
        "MEAN_MOTION_DDOT": 0.0,
    },
    "vanguard-1-2026-09-19": {
        "OBJECT_NAME": "VANGUARD 1",
        "OBJECT_ID": "1958-002B",
        "EPOCH": "2026-09-19T08:51:55.183680",
        "MEAN_MOTION": 10.86055068,
        "ECCENTRICITY": 0.1837898,
        "INCLINATION": 34.2533,
        "RA_OF_ASC_NODE": 23.635,
        "ARG_OF_PERICENTER": 203.2341,
        "MEAN_ANOMALY": 147.351,
        "EPHEMERIS_TYPE": 0,
        "CLASSIFICATION_TYPE": "U",
        "NORAD_CAT_ID": 5,
        "ELEMENT_SET_NO": 999,
        "REV_AT_EPOCH": 45352,
        "BSTAR": 0.00042909,
        "MEAN_MOTION_DOT": 0.00000351,
        "MEAN_MOTION_DDOT": 0.0,
    },
    "navstar-54-2026-09-19": {
        "OBJECT_NAME": "NAVSTAR 54 (USA 177)",
        "OBJECT_ID": "2004-009A",
        "EPOCH": "2026-09-19T07:47:02.588064",
        "MEAN_MOTION": 2.00573637,
        "ECCENTRICITY": 0.0118156,
        "INCLINATION": 54.7579,
        "RA_OF_ASC_NODE": 271.8753,
        "ARG_OF_PERICENTER": 176.6503,
        "MEAN_ANOMALY": 327.0021,
        "EPHEMERIS_TYPE": 0,
        "CLASSIFICATION_TYPE": "U",
        "NORAD_CAT_ID": 28190,
        "ELEMENT_SET_NO": 999,
        "REV_AT_EPOCH": 16483,
        "BSTAR": 0.0,
        "MEAN_MOTION_DOT": 0.00000021,
        "MEAN_MOTION_DDOT": 0.0,
    },
    "navstar-58-2026-09-19": {
        "OBJECT_NAME": "NAVSTAR 58 (USA 190)",
        "OBJECT_ID": "2006-042A",
        "EPOCH": "2026-09-19T11:23:54.732192",
        "MEAN_MOTION": 2.00565127,
        "ECCENTRICITY": 0.0108964,
        "INCLINATION": 54.7158,
        "RA_OF_ASC_NODE": 147.5934,
        "ARG_OF_PERICENTER": 57.3279,
        "MEAN_ANOMALY": 124.8096,
        "EPHEMERIS_TYPE": 0,
        "CLASSIFICATION_TYPE": "U",
        "NORAD_CAT_ID": 29486,
        "ELEMENT_SET_NO": 999,
        "REV_AT_EPOCH": 14628,
        "BSTAR": 0.0,
        "MEAN_MOTION_DOT": -0.0000002,
        "MEAN_MOTION_DDOT": 0.0,
    },
    "navstar-69-2026-09-18": {
        "OBJECT_NAME": "NAVSTAR 69 (USA 248)",
        "OBJECT_ID": "2014-008A",
        "EPOCH": "2026-09-18T22:01:15.984768",
        "MEAN_MOTION": 2.00565982,
        "ECCENTRICITY": 0.00835945,
        "INCLINATION": 53.6633,
        "RA_OF_ASC_NODE": 145.4942,
        "ARG_OF_PERICENTER": 231.5519,
        "MEAN_ANOMALY": 127.765,
        "EPHEMERIS_TYPE": 0,
        "CLASSIFICATION_TYPE": "U",
        "NORAD_CAT_ID": 39533,
        "ELEMENT_SET_NO": 999,
        "REV_AT_EPOCH": 9156,
        "BSTAR": 0.0,
        "MEAN_MOTION_DOT": -0.00000022,
        "MEAN_MOTION_DDOT": 0.0,
    },
    "navstar-77-2026-09-18": {
        "OBJECT_NAME": "NAVSTAR 77 (USA 289)",
        "OBJECT_ID": "2018-109A",
        "EPOCH": "2026-09-18T23:41:33.944352",
        "MEAN_MOTION": 2.00565483,
        "ECCENTRICITY": 0.00403049,
        "INCLINATION": 55.7414,
        "RA_OF_ASC_NODE": 88.486,
        "ARG_OF_PERICENTER": 196.2285,
        "MEAN_ANOMALY": 335.8508,
        "EPHEMERIS_TYPE": 0,
        "CLASSIFICATION_TYPE": "U",
        "NORAD_CAT_ID": 43873,
        "ELEMENT_SET_NO": 999,
        "REV_AT_EPOCH": 5695,
        "BSTAR": 0.0,
        "MEAN_MOTION_DOT": 0.00000011,
        "MEAN_MOTION_DDOT": 0.0,
    },
    "galileo-19-2026-09-17": {
        "OBJECT_NAME": "GSAT0215 (GALILEO 19)",
        "OBJECT_ID": "2017-079A",
        "EPOCH": "2026-09-17T16:41:23.094816",
        "MEAN_MOTION": 1.70473946,
        "ECCENTRICITY": 0.00032017,
        "INCLINATION": 55.0522,
        "RA_OF_ASC_NODE": 218.9624,
        "ARG_OF_PERICENTER": 283.7703,
        "MEAN_ANOMALY": 76.1661,
        "EPHEMERIS_TYPE": 0,
        "CLASSIFICATION_TYPE": "U",
        "NORAD_CAT_ID": 43055,
        "ELEMENT_SET_NO": 999,
        "REV_AT_EPOCH": 5456,
        "BSTAR": 0.0,
        "MEAN_MOTION_DOT": 0.00000018,
        "MEAN_MOTION_DDOT": 0.0,
    },
    "galileo-31-2026-09-19": {
        "OBJECT_NAME": "GSAT0226 (GALILEO 31)",
        "OBJECT_ID": "2024-167B",
        "EPOCH": "2026-09-19T03:37:44.620896",
        "MEAN_MOTION": 1.70473729,
        "ECCENTRICITY": 0.00022486,
        "INCLINATION": 55.1639,
        "RA_OF_ASC_NODE": 218.7444,
        "ARG_OF_PERICENTER": 247.7759,
        "MEAN_ANOMALY": 240.156,
        "EPHEMERIS_TYPE": 0,
        "CLASSIFICATION_TYPE": "U",
        "NORAD_CAT_ID": 61183,
        "ELEMENT_SET_NO": 999,
        "REV_AT_EPOCH": 1245,
        "BSTAR": 0.0,
        "MEAN_MOTION_DOT": 0.00000017,
        "MEAN_MOTION_DDOT": 0.0,
    },
}
ELEMENTS = {key: {field: omm[field] for field in OMM_FIELDS} for key, omm in PUBLISHED.items()}

# Offsets from each epoch at which a Position is recorded.
OFFSETS = [
    timedelta(0),
    timedelta(minutes=17, seconds=30),
    timedelta(hours=1),
    timedelta(hours=-12),
    timedelta(days=1),
    timedelta(days=3, hours=5, minutes=42),
]

# One Ground track per element set: a short window at a fixed step.
TRACK_START = timedelta(hours=2)
TRACK_STEP_SECONDS = 60
TRACK_POINTS = 12


def skyfield_satellite(key: str, timescale) -> EarthSatellite:
    """The Skyfield model of a fixture Satellite, built from its OMM fields."""
    return EarthSatellite.from_omm(timescale, ELEMENTS[key])


def iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"


def destination(latitude: float, longitude: float, bearing: float, angular_distance: float) -> tuple[float, float]:
    """The ground point at a bearing and angular distance from another, in degrees."""
    lat = math.radians(latitude)
    lon = math.radians(longitude)
    point_lat = math.asin(math.sin(lat) * math.cos(angular_distance) + math.cos(lat) * math.sin(angular_distance) * math.cos(bearing))
    point_lon = lon + math.atan2(
        math.sin(bearing) * math.sin(angular_distance) * math.cos(lat),
        math.cos(angular_distance) - math.sin(lat) * math.sin(point_lat),
    )
    point_lon = (point_lon + math.pi) % (2 * math.pi) - math.pi
    return math.degrees(point_lat), math.degrees(point_lon)


def course_over_ground(satellite, timescale, moment: datetime) -> float | None:
    """The Course at the instant as Skyfield sees it: the direction, in
    degrees clockwise from north, from the sub-point a moment before to the
    sub-point a moment after, both on the WGS84 ellipsoid; or None where the
    sub-point stands. The two displacements are measured along the
    ellipsoid's own meridian and parallel, whose radii of curvature differ
    by a part in 150 at the equator."""
    before, after = (
        wgs84.geographic_position_of(satellite.at(timescale.from_datetime(moment + sign * COURSE_HALF_STEP)))
        for sign in (-1, 1)
    )
    latitude = (before.latitude.radians + after.latitude.radians) / 2
    eccentricity_squared = WGS84_FLATTENING * (2 - WGS84_FLATTENING)
    stretch = 1 - eccentricity_squared * math.sin(latitude) ** 2
    meridian_km = WGS84_EQUATORIAL_KM * (1 - eccentricity_squared) / stretch**1.5
    parallel_km = WGS84_EQUATORIAL_KM / math.sqrt(stretch) * math.cos(latitude)
    east_radians = (after.longitude.radians - before.longitude.radians + math.pi) % (2 * math.pi) - math.pi
    north = meridian_km * (after.latitude.radians - before.latitude.radians)
    east = parallel_km * east_radians
    if math.hypot(north, east) / (2 * COURSE_HALF_STEP.total_seconds()) < STANDING_KM_PER_SECOND:
        return None
    return round(math.degrees(math.atan2(east, north)) % 360, 4)


def footprint_ring(satellite, timescale, moment: datetime, centre: dict, points: int) -> list[dict]:
    """The Footprint's edge as Skyfield sees it: along each bearing from the
    sub-point, the ground point from which the Satellite sits exactly on the
    horizon, found by bisection on Skyfield's elevation."""
    t = timescale.from_datetime(moment)

    def elevation_at(latitude: float, longitude: float) -> float:
        elevation, _, _ = (satellite - wgs84.latlon(latitude, longitude)).at(t).altaz()
        return elevation.degrees

    ring = []
    for i in range(points):
        bearing = 2 * math.pi * i / points
        above, below = 0.0, FOOTPRINT_SEARCH_RADIANS
        if elevation_at(*destination(centre["latitude"], centre["longitude"], bearing, below)) >= 0:
            raise SystemExit("Footprint search radius too small")
        for _ in range(FOOTPRINT_SEARCH_STEPS):
            middle = (above + below) / 2
            if elevation_at(*destination(centre["latitude"], centre["longitude"], bearing, middle)) >= 0:
                above = middle
            else:
                below = middle
        latitude, longitude = destination(centre["latitude"], centre["longitude"], bearing, (above + below) / 2)
        ring.append({"latitude": round(latitude, 6), "longitude": round(longitude, 6)})
    return ring


def main() -> None:
    timescale = load.timescale(builtin=True)
    planets = load("de421.bsp")
    earth, sun = planets["earth"], planets["sun"]
    elements_out = {}
    positions = []
    tracks = []
    footprints = []

    for key, omm in ELEMENTS.items():
        satellite = skyfield_satellite(key, timescale)
        epoch = satellite.epoch.utc_datetime()
        period_seconds = 2 * math.pi / satellite.model.no_kozai * 60
        elements_out[key] = {
            "omm": omm,
            "catalogueNumber": omm["NORAD_CAT_ID"],
            "epoch": iso(epoch),
            "periodSeconds": round(period_seconds, 4),
            # The apsides as SGP4's record holds them once initialised, in
            # Earth radii above the surface, put into kilometres.
            "apogeeKm": round(satellite.model.alta * SGP4_EARTH_RADIUS_KM, 4),
            "perigeeKm": round(satellite.model.altp * SGP4_EARTH_RADIUS_KM, 4),
        }

        def mean_anomaly_degrees(moment: datetime) -> float:
            """The mean anomaly at the instant: the record's at its epoch,
            carried forward at the mean motion the OMM states."""
            minutes = (moment - epoch).total_seconds() / 60
            return round(math.degrees(satellite.model.mo + satellite.model.no_kozai * minutes) % 360, 6)

        def position_at(moment: datetime) -> dict:
            geocentric = satellite.at(timescale.from_datetime(moment))
            point = wgs84.geographic_position_of(geocentric)
            return {
                "at": iso(moment),
                "latitude": round(point.latitude.degrees, 6),
                "longitude": round(point.longitude.degrees, 6),
                "altitude": round(point.elevation.km, 4),
                "speedKmPerSecond": round(float(geocentric.speed().km_per_s), 5),
            }

        footprint_at = epoch + FOOTPRINT_OFFSET
        centre = position_at(footprint_at)
        ring = footprint_ring(satellite, timescale, footprint_at, centre, FOOTPRINT_POINTS)
        footprints.append({"elements": key, "at": iso(footprint_at), "centre": centre, "ring": ring})

        for offset in OFFSETS:
            moment = epoch + offset
            positions.append({"elements": key, **position_at(moment), "course": course_over_ground(satellite, timescale, moment), "meanAnomalyDegrees": mean_anomaly_degrees(moment)})

        start = epoch + TRACK_START
        tracks.append(
            {
                "elements": key,
                "from": iso(start),
                "stepSeconds": TRACK_STEP_SECONDS,
                "points": [
                    position_at(start + timedelta(seconds=TRACK_STEP_SECONDS * i))
                    for i in range(TRACK_POINTS)
                ],
            }
        )

    subsolar = []
    for moment in SUBSOLAR_INSTANTS:
        apparent = earth.at(timescale.from_datetime(moment)).observe(sun).apparent()
        point = wgs84.subpoint_of(apparent)
        subsolar.append({"at": iso(moment), "latitude": round(point.latitude.degrees, 6), "longitude": round(point.longitude.degrees, 6)})

    fixture = {
        "generatedBy": "oracle/positions.py with Skyfield",
        "tolerance": {
            "positionKm": TOLERANCE_KM,
            "speedKmPerSecond": TOLERANCE_SPEED_KM_PER_SECOND,
            "periodSeconds": TOLERANCE_PERIOD_SECONDS,
            "subsolarDegrees": TOLERANCE_SUBSOLAR_DEGREES,
            "footprintKm": TOLERANCE_FOOTPRINT_KM,
            "courseDegrees": TOLERANCE_COURSE_DEGREES,
            "meanAnomalyDegrees": TOLERANCE_MEAN_ANOMALY_DEGREES,
            "apsidesKm": TOLERANCE_APSIDES_KM,
        },
        "elements": elements_out,
        "positions": positions,
        "tracks": tracks,
        "footprints": footprints,
        "subsolar": subsolar,
    }
    out = Path(__file__).resolve().parent.parent / "fixtures" / "positions.json"
    out.write_text(json.dumps(fixture, indent=2) + "\n")
    print(f"wrote {len(positions)} positions, {len(tracks)} tracks, {len(footprints)} footprints and {len(subsolar)} subsolar points to {out}")


if __name__ == "__main__":
    main()
