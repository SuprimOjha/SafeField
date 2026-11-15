# WP0 Audit — Safe Field Nepal

Read-only audit of the repository at commit `1099bff` (`main`), performed 2026-11-15.
No application code was changed. The only added file is this report.

## 1. Repository and deployment state

- `netlify.toml` builds `frontend/` with `npm run build` and publishes `.next` through `@netlify/plugin-nextjs`. The README lists the live prototype as https://safefieldnp.netlify.app.
- There is no `vercel.json`, `render.yaml` or Dockerfile in the repository. `backend/app/config.py:7-10` still allow-lists the old Vercel origin, so that is a CORS compatibility leftover, not a deployment definition.
- Which branch Netlify deploys is a Netlify UI setting and is not recorded in the repository: **COULD NOT VERIFY**.
- Local `main` and `origin/main` both point at `1099bff`. There are 18 other remote branches; most are merge/squash history behind `main`, and `origin/codex/safefield-120-followup` is 3 commits ahead. No `data` branch exists.
- CI (`.github/workflows/ci.yml:3-7`) runs on pushes to `main` and `codex/**` and on pull requests to `main`. A new feature branch without a pull request will not run CI.
- CI jobs: backend `validate-content` + `pytest`; frontend `npm ci`, `test:gps`, `lint`, `build`. It does not run `test:i18n`, `test:ask` or `test:field-survey`, and there is no backend lint step.

## 2. What already exists

### Backend (FastAPI, `backend/`)

- Routes (`backend/app/api/routes.py`): `GET /api/field-assessment`, `GET /api/districts`, `GET /api/integrations/imerg/status`. `GET /api/health` is in `backend/app/main.py`.
- There is **no** `/api/content` route, although `frontend/src/components/FarmerContentPanel.tsx:16-17` requests one from a Render host and silently hides on failure.
- Upstream clients: NASA POWER, Open-Meteo forecast, Open-Meteo past days, ISRIC SoilGrids, Open-Meteo elevation, NASA CMR/GIBS.
- IMERG pipeline:
  - CLI: `python -m app.cli fetch-imerg --days N` (`backend/app/cli.py:23-38`), interactive credential prompt when env vars are absent.
  - Fetch walks back 5 extra days, searches CMR `GPM_3IMERGDL` version `07`, refuses mixed granule versions, crops to the Nepal bbox, and writes per-cell SQLite rows (`backend/app/services/imerg/fetch_daily.py:43-93`).
  - Gates: 39/48 half-hour samples per day, 80% polygon coverage, rejection of non-finite/negative values, date-gap rejection, mixed-version rejection, 5-day cache freshness (`backend/app/services/imerg/grid_cache.py:10-13,86-113,139,224-226`).
  - Point lookup uses the nearest cached cell; polygon lookup uses EPSG:6933 equal-area intersections and area weighting.
  - If a granule ID cannot be parsed, `store_daily_grid` falls back to version `"07C"` (`grid_cache.py:50-58`). This weakens the “version read from the data” rule.
- Decision engine: `backend/app/decision/fertilizer_engine.py` plus `rules.json` v1.1.0. Thresholds are explicitly labelled design assumptions. The save-money flag is intentionally non-operative.
- Water balance: `backend/water_balance.py` implements FAO-56-style depletion, Ks, days-to-trigger and volume. It is **not imported anywhere outside its tests**.
- Content validators: `backend/app/content_packs/loader.py` enforces source linkage, official-source rules, dose-pattern rejection and verified flags. The data files contain only `_example` entries and empty `records` arrays, so the validator reports success with **0 sources and 0 records**.
- Tests: 171 backend tests, all passing locally.

### Frontend (Next.js 16 App Router, `frontend/`)

- Single-page app with tabs Today, My field, Climate trends, Ask, More (`frontend/src/app/page.tsx`).
- Production assessment path is the self-contained `frontend/src/app/api/field-assessment/route.ts`. It does **not** call the Python backend and does **not** read the IMERG cache. Its rainfall card uses Open-Meteo past-days reanalysis, honestly labelled `kind: "model"` and non-NASA (`frontend/src/lib/server/rainfall.ts`).
- NASA POWER wetness is shown as a modelled proxy; SoilGrids texture and Open-Meteo elevation/forecast are used; the decision engine is duplicated in `frontend/src/lib/server/decision.ts` with inline thresholds.
- Field survey: `ScreenAHome.tsx` uses `averageFixes` from `frontend/src/lib/gps-average.ts` with tests.
- Provenance UI: `DecisionCard`, `DataReceiptDrawer`, `FreshnessStrip`, Data Status content in Methods.
- i18n: 310 matching en/ne keys, Nepali default. `npm run test:i18n` passes. There are **0** `// review` markers in `ne.ts`.
- Privacy: the client rounds coordinates to 2 decimals and passes `null` for the field polygon (`frontend/src/app/page.tsx:372-380`), so the polygon is never sent even when drawn.
- Absent: splash reveal, per-signal tiles for soil/heat/plants, Stress Watch, Source Agreement badges, low-bandwidth mode, Replay, `/api/data-status`, `status.json`, `SignalProvider`, SMAP/LST/NDVI ingestion.

## 3. Live catalog verification (NASA CMR, 2026-11-15)

| Short name | CMR version | Latest granule start (UTC) | Note |
|---|---|---|---|
| `GPM_3IMERGDL` | 07 | 2026-11-13 | Granule `...20261113...V07C.nc4`; code accepts `07` and parses `V07C` |
| `SPL4SMGP` | 008 | 2026-11-10T21:00 | Granule includes `Vv8013` |
| `MOD11A1` | 061 | 2026-11-13 | Terra LST still available at audit time |
| `MYD11A1` | 061 | 2026-11-13 | Aqua LST |
| `VNP21A1D` | 002 | 2026-11-02 | VIIRS LST 11 days behind MODIS at audit time |
| `VNP21A1N` | 002 | 2026-11-02 | Same lag |
| `MOD13Q1` | 061 | 2026-10-16 | 16-day composite start |
| `VNP13A1` | 002 | 2026-10-24 | More recent composite than MOD13Q1 at audit time |

The repository documentation states “V07B” (`docs/DATA_PROVENANCE.md:27`), while live granules are `V07C`. The code already handles `V07C`; the document is stale.

## 4. Conflicts and risks against the prompt

1. **P0 — the deployed rain signal is not NASA IMERG.** Production uses the Next.js route with Open-Meteo reanalysis. IMERG only exists behind the un-deployed Python API. Definition of Done item 2 is currently unmet.
2. **P0 — automation does not persist data.** `.github/workflows/imerg-refresh.yml` has `contents: read`, uploads a 7-day artifact and does not commit `status.json` or snapshots to a `data` branch. There is no size guard, prune rule, concurrency group, retry/backoff, job timeout or `/api/data-status`.
3. **P0 — no signal framework.** There is no `SignalProvider` interface, unified provenance envelope or `status.json` reader/writer.
4. **P0 — missing signals.** No SMAP, LST or NDVI provider, anomaly calculation or UI tile.
5. **P1 — polygon contract differs.** The API accepts up to 200 vertices (prompt says 100), checks only the Nepal bbox (no self-intersection or area limit), and the frontend validates then discards the polygon. A polygon therefore never improves the rain calculation in production.
6. **P1 — duplicated decision logic.** Thresholds live in both `backend/app/decision/rules.json` and `frontend/src/lib/server/decision.ts` with inline defaults. There are no `sourceKey` links in the rules.
7. **P1 — content and irrigation are not usable.** Content packs are empty, so any crop/soil parameter is missing; the water balance is not wired and irrigation must remain `not_assessed`.
8. **P1 — version provenance fallback.** An unparseable granule ID is silently stored as `07C` instead of failing closed.
9. **P1 — CI coverage gaps.** Branch pushes do not trigger CI; i18n, Ask and survey tests are not in CI; there is no backend lint.
10. **P2 — accessibility deviations.** Body text is 18 px and inputs 16 px (`globals.css:211,217`), but bottom-nav labels are 11 px (`page.tsx:569`) and the language toggle is 40 px tall (`page.tsx:217`), below the prompt’s 16 px/48 px rules.
11. **P2 — dead external dependency.** `FarmerContentPanel` calls a Render-hosted `/api/content` route that does not exist in this repository.
12. **P2 — Nepali review markers.** `ne.ts` contains no `// review` markers despite the requirement to mark uncertain translations.

## 5. Positive findings

- No fabricated measurements were found in the reviewed paths; missing values stay `null` and produce `UNAVAILABLE`/`LOCAL REVIEW NEEDED`.
- NASA vs non-NASA labels are generally honest (POWER wetness proxy, Open-Meteo model, SoilGrids prediction, resolution caveats).
- Dose-pattern rejection and the “not yet reviewed by a Nepali agronomist” string exist and are used.
- Offline cache preserves original timestamps and relabels data as `CACHED_FALLBACK`.
- IMERG gates are conservative and fail closed on gaps, mixed versions and low coverage.
- Backend tests are meaningful, not smoke-only: 171 passing.

## 6. Commands run (real output)

| Command | Result |
|---|---|
| `python -m pytest -q` (backend) | `171 passed, 1 warning in 21.74s` |
| `python -m app.cli validate-content` (backend) | `status: ok`, sources 0, all record types 0 |
| `node scripts/check-i18n-parity.mjs` | `i18n key parity passed: 310 matching keys` |
| CMR collection queries for 8 products | Versions listed in section 3 |
| CMR latest-granule queries for 8 products | Dates listed in section 3 |
| Frontend `npm ci`, `lint`, `build` | **COULD NOT COMPLETE in this run**; dependency installation did not finish before the audit was reported. CI config is present but unverified locally. |

## 7. COULD NOT VERIFY

- Which branch Netlify deploys, and whether a Python backend is deployed anywhere in production.
- Earthdata authentication, granule download and the actual HDF5/NetCDF variable names and units inside V07C. CMR is public; Earthdata download needs credentials that are not present here.
- Measured IMERG publication delay. The latest granule observed was 2026-11-13 on 2026-11-15, which is consistent with a lag but is a single observation, not a measured distribution.
- Live SMAP, LST and NDVI file structures and QA/QC bit definitions.
- Frontend lint/build results in this environment.

Manual verification commands:

```bash
cd backend && python -m app.cli fetch-imerg --days 2   # requires Earthdata credentials
cd frontend && npm ci && npm run lint && npm run build && npm run test:i18n
```

## 8. Recommended implementation order and rough effort

The estimates below are planning ranges, not measured results.

| WP | Scope | Estimate |
|---|---|---|
| WP1 | Signal framework: provider interface, provenance envelope, `status.json` reader/writer, gate config, tests | 0.5–1 day |
| WP2 | IMERG automation: `ingest`/`status`/`backfill` CLI, gap fill, data-branch persistence, workflow, `/api/data-status`, tests | 1–1.5 days |
| WP3 | SMAP L4 ingestion, crop, anomaly, model-only labelling, tests | 1.5–2 days |
| WP4 | Heat: POWER + forecast heat days, LST provider with QC, availability check, anomaly, tests | 1–1.5 days |
| WP5 | NDVI/EVI provider with QA masking, anomaly, insufficient-data state, tests | 1 day |
| WP6 | Per-field aggregation, versus-normal classes, Stress Watch and Source Agreement, tests | 1 day |
| WP7 | Rain impact, water balance/irrigation `not_assessed` path, spray/fertilizer windows, tests | 1 day |
| WP8 | API contracts and validation (100 vertices, self-intersection, area limit), tests | 0.5 day |
| WP9 | Design tokens and Today screen with real signals | 1 day |
| WP10 | Signal tiles, sparklines, diary, farmer logs | 1 day |
| WP11 | Survey completion and map layers | 1 day |
| WP12 | Trends, Ask, settings, splash, i18n/accessibility, CI, README, deployment smoke test | 1 day |

Total: roughly 12–14 engineer-days. Critical path: WP1 → WP2 → WP6 → WP8/9. WP3, WP4 and WP5 can run in parallel after WP1.

## 9. Decision needed before WP2

The production surface is the Netlify-hosted Next.js app; the Python backend is not deployed. To satisfy the “NASA signal on screen with granule IDs” requirement, choose one:

- **A (recommended):** keep Netlify as the only deployed surface. Persist snapshots and `status.json` to a `data` branch, and have the Next.js route read them (with ETag caching and a local fixture fallback). FastAPI remains the contract/reference implementation.
- **B:** deploy the FastAPI backend and point `NEXT_PUBLIC_API_BASE_URL` at it, then keep the existing Next.js route as fallback.

Option A avoids a second hosting dependency and keeps one source of truth for the farmer UI; option B reuses more existing Python code but adds hosting, cold-start and credential-management risk.

## 10. One manual action required

Confirm the Netlify deploy branch and the chosen deployment topology (A or B), and add `EARTHDATA_USERNAME` / `EARTHDATA_PASSWORD` as GitHub repository secrets if live IMERG ingestion is expected.
