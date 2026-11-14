# Data provenance and limitations

This document describes only the current `GET /api/field-assessment` integration.

| Input | Current source | Role | Important limitation |
|---|---|---|---|
| Rainfall, temperature | NASA POWER daily point API | Historical context and screening input | PRECTOTCORR is gridded reanalysis-based data at roughly 0.5° × 0.625° (~55 km); daily records can lag several days |
| Surface/root wetness | NASA POWER GWETTOP/GWETROOT | Modelled wetness proxies | Not SMAP observations, not in-situ probes, and not volumetric water content |
| Forecast | Open-Meteo | Next 48-hour rain outlook | Non-NASA forecast; model grid and forecast uncertainty apply |
| Soil texture | ISRIC SoilGrids | Predicted sand/silt/clay fractions | 250 m prediction for 0–5 cm topsoil; not a plot-level soil test |
| Elevation/slope | Open-Elevation API | 3×3 stencil elevation and slope estimate | Integration requests Open-Elevation; underlying DEM lineage and resolution are not verified |

## Not connected to the field assessment
GPM IMERG, SMAP and NASADEM are not queried by the current field-assessment endpoint. Do not describe them as active inputs to the decision.

## Freshness semantics
- `LIVE`: fetched successfully from the upstream service.
- `CACHED_FALLBACK`: a cached response is being reused; inspect its fetched timestamp.
- `UNAVAILABLE`: no usable value is available. Null values must remain null and must never be silently converted to zero or a favorable default.

A fetch timestamp is not the same as the observation date. Always show both where available.
