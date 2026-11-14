# GPM IMERG integration status

**Status: PARTIALLY INTEGRATED.** The field-assessment endpoint can use a locally cached GPM IMERG Late daily grid. It does not perform live downloads during farmer requests.

## Implemented
- Earthdata Login environment authentication through the fetch-imerg CLI.
- Discovery of GPM_3IMERGDL daily Late granules using CMR collection version 07 (NASA's GPM directory identifies the current algorithm line as V07B).
- Nepal bounding-box crop, explicit checks for precipitation and precipitation_cnt, and fail-closed unit validation.
- Persistent SQLite grid-cell cache with observed UTC date, fetch time, granule ID, stream and version.
- Read-only ImergLateProvider; the API uses the most recent three consecutive UTC daily grids when fresh.
- NASA POWER is an explicitly labelled fallback when IMERG is unavailable or stale.
- GET /api/integrations/imerg/status reports whether a fresh local cache is installed.

## Not yet implemented
1. Field polygon/cell intersection and area-weighted field aggregation. The current assessment uses the nearest cached IMERG grid-cell centre for the selected point.
2. Real granule fixture integration tests and gauge comparison.
3. Automatic propagation of the refresh workflow artifact into the deployed API service's persistent storage.
4. Full production monitoring for missing days, failed refreshes and dataset version changes.

Late and Final streams remain separate. Do not describe the current point lookup as a polygon-average rainfall estimate or a field-validated agronomic measurement.
