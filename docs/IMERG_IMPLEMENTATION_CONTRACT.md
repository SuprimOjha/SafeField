# GPM IMERG implementation contract

## Current state

The backend exposes an explicit integration status at `GET /api/integrations/imerg/status`. It currently reports `NOT_CONNECTED`; it does not discover, download or process granules. The field assessment does not consume IMERG.

## Contract implemented

- `backend/app/services/imerg/contracts.py` records product, version, Late/Final stream, granule ID, observation interval, processing time, source URL and nominal spatial resolution.
- Intersecting cells carry an intersection area, precipitation value and explicit quality state.
- The summary uses an area-weighted mean only when valid spatial coverage meets the configured operational completeness threshold.
- Missing, suspect and rejected cells are excluded, never converted to zero.
- Insufficient coverage produces a null estimate and an explicit unavailable/partial status.

## Work still required before activation

1. Implement NASA Earthdata authentication and granule discovery/download.
2. Verify product-specific quality flags and units against official product documentation.
3. Derive cell-field intersection areas from the actual selected field geometry.
4. Keep Late and Final observations separate in API responses and UI.
5. Preserve all source metadata and cache provenance through the full pipeline.
6. Compare results against local gauges and obtain domain-expert review.
7. Add integration tests with real, documented sample granules.

Do not use the contract helper as a substitute for a validated IMERG reader. The current test fixtures are synthetic software tests, not scientific validation data.
