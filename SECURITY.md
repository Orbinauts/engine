# Security policy

## Supported versions

Fixes are made on the latest release only. Until 1.0.0 that means the newest 0.x version on npm.

## Reporting a vulnerability

Please do not open a public issue for a vulnerability. Write to **hello@orbinauts.com** with what you found, the version, and the smallest input that shows it; or use GitHub's private vulnerability reporting on this repository if it is offered. We aim to answer within a week, and to ship a fix, or say why there will be none, as soon as the report is understood. The release notes credit you unless you would rather they did not.

The library makes no network request, reads no storage and no environment, and runs no code it is handed, so the likeliest findings are inputs that make it hang, exhaust memory or answer silently wrong numbers; those are welcome too.
