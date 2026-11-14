# GPM IMERG implementation contract

## Current state

The field assessment uses a fresh local GPM IMERG Late daily cache when installed. It falls back to NASA POWER only when the IMERG cache is missing/stale or cannot provide sufficient polygon coverage and three consecutive POWER daily values are available. The API does not download data during farmer requests. GET /api/integrations/imerg/status reports local cache readiness.

## Implemented
- The contracts module records product, version, Late/Final stream, granule ID, observation interval, processing time, source URL and nominal spatial resolution.
- The fetch module authenticates through Earthdata, discovers GPM_3IMERGDL daily Late granules, checks required variables/units, and crops to Nepal.
- The grid cache persists daily grid cells and excludes cells with no valid sample count.
- The provider reads the latest three consecutive daily cells and rejects stale cache data.
- Point selection uses the nearest grid cell. Drawn polygons use EPSG:6933 equal-area intersections and area-weighted daily values, with at least 80% effective spatial/temporal coverage on every day; each cell's intersection area is weighted by precipitation_cnt / 48. Point lookup requires at least 39 of 48 half-hour samples. These are software quality gates, not NASA-issued quality flags.
- The decision engine receives one typed RainfallObservation with source kind, spatial method, coverage and provenance, and records that provenance in its rule contributions.
- Missing, stale or insufficiently covered data are never converted to zero.

## Remaining before operational use
1. Compare point and polygon results against local rain gauges and obtain domain-expert review.
2. Verify product-specific quality flags and units against current NASA product documentation.
3. Configure persistent deployment storage for refreshed cache data.
4. Add integration tests with real, documented sample granules and monitor product-version changes.

Current automated tests use synthetic fixtures; they validate software logic, not scientific accuracy or live NASA service availability.
