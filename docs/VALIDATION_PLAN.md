# Scientific and field validation plan

## Current status
The project is a research prototype. The decision thresholds have not been reviewed by Nepalese agronomists, and the interface must say so.

## Data checks
- Record source, observation date, fetch timestamp, resolution, latency and cache status for each service.
- Verify NASA POWER daily dates against the official API; do not call delayed daily values real-time observations.
- Compare POWER precipitation with a suitable local gauge and, when integrated, GPM IMERG Late.
- Confirm SoilGrids layer names, units/scaling, depth and null handling.
- Confirm the underlying DEM source and resolution before making NASADEM/SRTM claims.

## Rule validation
- Obtain written review from NARC or qualified local agronomists.
- Validate rainfall thresholds by crop stage, soil, irrigation and fertilizer formulation.
- Validate slope and texture thresholds against field evidence.
- Keep cost-saving preference non-operative until reviewed for under-application risk.

## Human testing
- Test with farmers and extension workers in the pilot districts.
- Measure time to first useful result, location-selection success, comprehension and trust.
- Test low-bandwidth Android phones, GPS permission denial and one-tap/district workflows.
- Treat polygon drawing as optional refinement, not a required gate.

## Release gate
Do not call the tool a validated agronomic recommendation system until the above checks have documented evidence and sign-off.
