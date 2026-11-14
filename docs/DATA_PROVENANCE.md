# Data provenance and limitations

This document describes only the current `GET /api/field-assessment` integration.

| Input | Current source | Role | Important limitation |
|---|---|---|---|
| Rainfall | NASA GPM IMERG Late daily cache when fresh; NASA POWER PRECTOTCORR fallback | 72-hour total from the latest three complete UTC daily grids; POWER is used only when IMERG cache is missing/stale | IMERG is 0.1° (~10 km): point selection uses nearest cell; drawn polygons use equal-area cell intersections with at least 80% daily coverage. POWER is much coarser (~55 km) and may lag several days |
| Temperature | NASA POWER daily point API | Historical context | Gridded reanalysis-based data; not an on-farm sensor |
| Surface/root wetness | NASA POWER GWETTOP/GWETROOT | Modelled wetness proxies | Not SMAP observations, not in-situ probes, and not volumetric water content |
| Forecast | Open-Meteo | Next 48-hour rain outlook | Non-NASA forecast; model grid and forecast uncertainty apply |
| Soil texture | ISRIC SoilGrids | Predicted sand/silt/clay fractions | 250 m prediction for 0–5 cm topsoil; not a plot-level soil test |
| Elevation/slope | Open-Elevation API | 3×3 stencil elevation and slope estimate | Integration requests Open-Elevation; underlying DEM lineage and resolution are not verified |

## Connection state
GPM IMERG Late is used when a fresh local daily cache is installed. The API does not download granules during farmer requests. If the cache is missing or stale, the field assessment uses NASA POWER only when three consecutive daily values are available, and labels it as a fallback. GPM IMERG Final, SMAP and NASADEM are not queried by the current field-assessment endpoint.

## Freshness semantics
- `LIVE`: fetched successfully from the upstream service.
- `CACHED_FALLBACK`: a cached response is being reused; inspect its fetched timestamp.
- `UNAVAILABLE`: no usable value is available. Null values must remain null and must never be silently converted to zero or a favorable default.

A fetch timestamp is not the same as the observation date. Always show both where available.


## GPM IMERG Late cache

The optional IMERG ingestion command uses the GPM_3IMERGDL daily Late collection (CMR version 07; NASA's current GPM directory describes the V07B algorithm line). The daily `precipitation` field is stored in mm/day, with `precipitation_cnt` used to exclude cells with no valid half-hourly samples. The code fails closed if the expected variables or units are absent. NASA's IMERG V07 FAQ identifies `precipitation` as the recommended multi-satellite field and documents its units; consult the current collection metadata before future upgrades.

The fetch timestamp is distinct from the observation UTC day. The Late Run is intended for near-real-time monitoring, while Final Run is a retrospective research product with substantially longer latency. Do not mix Late and Final streams in one time series.
