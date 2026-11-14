# GPM IMERG integration status

**Status: NOT CONNECTED to the field-assessment endpoint.**

The current backend route imports a NASA CMR/GIBS client, but its field assessment does not request GPM IMERG precipitation values. Listing a catalog or map layer is not equivalent to using IMERG as a decision input.

## Integration requirements
1. Select the appropriate GPM IMERG product and latency stream (Late for recent rainfall, Final for retrospective research).
2. Preserve product version, granule identifiers, observation interval, processing timestamp and spatial resolution.
3. Extract the grid cells intersecting the selected field polygon or point, with quality flags and missing-data handling.
4. Keep IMERG Late separate from Final Run in the UI and API.
5. Compare against local gauges where possible.
6. Add tests for missing granules, partial coverage, delayed updates and cache expiry.

Until implemented and tested, do not claim that IMERG powers the live decision.
