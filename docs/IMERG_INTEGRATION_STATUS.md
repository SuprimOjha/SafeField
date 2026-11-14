# GPM IMERG integration status

**Status: INTEGRATED FOR POINT AND DRAWN-POLYGON RAINFALL SCREENING, SUBJECT TO A FRESH LOCAL CACHE.** The field-assessment endpoint reads only the local SQLite cache; it never downloads a granule during a farmer request.

## Implemented
- Earthdata Login environment authentication through the fetch-imerg CLI.
- Discovery of GPM_3IMERGDL daily Late granules using CMR collection version 07 (NASA's GPM directory identifies the current algorithm line as V07B).
- Nepal bounding-box crop, explicit checks for precipitation and precipitation_cnt, and fail-closed unit validation.
- Persistent SQLite grid-cell cache with observed UTC date, fetch time, granule ID, stream and version.
- Read-only ImergLateProvider with a five-day cache freshness limit and three consecutive UTC daily totals.
- Point selection uses the nearest cached grid cell.
- Drawn field polygons use EPSG:6933 equal-area cell intersections and area-weighted daily precipitation, only when at least 80% effective coverage is achieved on every day after weighting cell intersections by precipitation_cnt / 48. Point lookup requires at least 39 of 48 half-hour samples. These are conservative software quality gates, not NASA-issued quality flags.
- Invalid geometry, date gaps, stale cache, unexpected grid spacing and insufficient coverage return UNAVAILABLE rather than zero or a fabricated estimate.
- NASA POWER is an explicitly labelled point fallback when IMERG is unavailable or stale.
- GET /api/integrations/imerg/status reports whether a fresh local cache is installed.

## Remaining
1. Validate the polygon aggregation against documented real granules and local rain gauges.
2. Verify product-specific quality flags and units against current NASA product metadata after any collection version change.
3. Configure persistent storage so the scheduled workflow refresh artifact reaches the deployed API service.
4. Add production monitoring for missing days, failed refreshes and dataset version changes.
5. Complete end-to-end farmer-device and field-boundary usability testing.

Late and Final streams remain separate. The polygon estimate is a grid-derived screening value, not a survey-grade field measurement or agronomic validation.
