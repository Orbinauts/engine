---
status: accepted
date: 2026-09-03
---

# A TypeScript library, with Skyfield as its test oracle

The library (propagation, pass search, the Earth-shadow test, brightness,
ephemeris interpolation) is written once in TypeScript on `satellite.js` and
`astronomy-engine`, so that the same code runs on a server, in a browser and
in a Cloudflare Worker. Python's Skyfield has all of that geometry built in
and would have saved a few hundred lines of maths, but a Python library
cannot run in a browser: an application that draws satellites on a map in
the browser and answers the same questions on a server would carry two
runtimes and two propagation implementations that could disagree, and a
server on Python pays a heavier cold start on a platform that scales to
zero. We chose one language and accepted owning the maths.

The risk of owning the maths is being quietly wrong, so the library is
tested against Skyfield rather than against hand-picked expected values.
Python scripts, the Oracle in `oracle/`, compute positions, pass times,
sunlit flags and brightness for known Elements, observers and instants and
write them to `fixtures/`, each file with the tolerances the answers must
meet; the TypeScript tests assert agreement within them. Python is a
development-time oracle only: it never runs where the library runs, and the
tests read the fixtures without it.

## Considered options

- A Python library on Skyfield behind an HTTP service: the strongest
  astronomy ecosystem, but two runtimes, and a browser cannot share the
  computation.
- `sgp4` with `astropy` in Python: the heaviest imports and the worst cold
  start.
- TypeScript on `satellite.js` alone: it propagates, but has no Sun, Moon or
  frame rotations, which the shadow test, brightness and an ephemeris in the
  J2000 frame need; `astronomy-engine` fills that gap.

## Consequences

- Every function that computes a physical answer needs an Oracle fixture
  before it is trusted, and the README's tolerances table states what each
  fixture holds it to.
- Reopen this decision only if solar and lunar transits or the prediction of
  a satellite's streak across a camera's field prove infeasible in
  TypeScript.
