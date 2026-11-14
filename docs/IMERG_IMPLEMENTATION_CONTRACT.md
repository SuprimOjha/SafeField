# GPM IMERG implementation contract

## Current state

The field assessment uses a fresh local GPM IMERG Late daily cache when installed. It falls back to NASA POWER only when the IMERG cache is missing/stale and three consecutive POWER daily values are available. The API does not download data during farmer requests. The endpoint GET /api/integrations/imerg/status reports local cache readiness.

## Implemented
- The contracts module records product, version, Late/Final stream, granule ID, observation interval, processing time, source URL and nominal spatial resolution.
- The fetch module authenticates through Earthdata, discovers GPM_3IMERGDL daily Late granules, checks required variables/units, and crops to Nepal.
- The grid cache persists daily grid cells and excludes cells with no valid sample count.
- The provider reads the latest three consecutive daily cells and rejects stale cache data.
- The decision engine receives one typed RainfallObservation with source kind and provenance, and records that provenance in its rule contributions.
- Missing or rejected data are never converted to zero.

## Remaining before field-level activation
1. Intersect each IMERG grid-cell polygon with the farmer's selected field polygon and calculate area-weighted values. Current field assessment uses nearest point-cell lookup only.
2. Verify product-specific quality flags and units against current NASA product documentation.
3. Keep Late and Final observations separate in API responses and UI.
4. Preserve all source metadata through any future polygon aggregation and cache changes.
5. Compare results against local rain gauges and obtain domain-expert review.
6. Add integration tests with real, documented sample granules.

Current tests use synthetic fixtures; they validate software logic, not scientific accuracy or live NASA service availability.
