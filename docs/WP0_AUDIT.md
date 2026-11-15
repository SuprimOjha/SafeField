# WP0 Audit — Safe Field Nepal (Parts A–F)

Read-only audit of `main` at commit `47968d3` on 2026-11-15. No application code was
changed. This report supersedes the earlier WP0 audit written against commit `1099bff`
on the `audit/wp0` branch, which predates the Render deployment, Supabase persistence
and signal framework.

## 1. What is deployed and working

- **Frontend (Netlify).** `netlify.toml` builds `frontend/` and sets
  `NEXT_PUBLIC_API_BASE_URL=https://safefield-nepal-spaceapps-2026.onrender.com`;
  the built chunk on https://safefieldnp.netlify.app embeds that host, and the CORS
  preflight from the Netlify origin returns 200. `frontend/src/lib/api.ts:7` uses the
  variable, falling back to the same-origin Next.js route.
- **Backend (Render).** FastAPI runs on the free Web Service with `/api/health` as the
  health check. Live checks on 2026-11-15: `postgres ok`, `storage ok`
  (bucket `safefield-data`), `error: null`; IMERG cache `CACHE_READY` with
  2026-11-11/12/13 and 3,486 cells per day; `/api/field-assessment` returns rainfall
  `AVAILABLE` from IMERG V07C granules for all three days.
- **Scheduling.** The backend runs an in-process scheduler (`DATA_REFRESH_ENABLED`);
  `.github/workflows/imerg-refresh.yml` runs a second daily IMERG refresh with
  `contents: read`, so it cannot persist results anywhere by itself.
  `.github/workflows/data-publish.yml` publishes snapshots and `status.json` to an
  orphan `data` branch, but no application reads that branch.

## 2. Module inventory against this prompt

### Part A — pre-application advisor

| Requirement | Current state |
|---|---|
| Three application modes (granular, foliar, pesticide) | **Missing.** `backend/app/decision/fertilizer_engine.py:41` has one `evaluate_timing` path; `fertilizer_type` and `crop_stage` are accepted but only echoed, never branched on. |
| 12-item checklist with OK / CHECK / WAIT and `ruleBasis` | **Missing.** No checklist model, no per-item status or basis field. |
| Wind, temperature, hourly best window | **Missing as inputs.** `backend/app/services/forecast_client.py:127` requests daily max wind, daily max/min temperature and **hourly precipitation only**; no hourly wind or temperature. |
| Soil fullness (water-balance `Dr`), SMAP root zone | **Not wired to this decision.** `Dr` is not computed for the field and SMAP signals are a separate read path. |
| Slope, marked water source / low spot | Slope exists from elevation; survey point types exist in the frontend but are never sent to the backend (`page.tsx` passes `null` for geometry). |
| Protection/label/4R/soil-test/split-application items | **Missing.** Only general safety copy in `frontend/src/i18n/en.ts:197-206`. |
| Output: `CONDITIONS LOOK SUITABLE` / `WAIT AND RECHECK` / `LOCAL REVIEW NEEDED`, best window, recheck hours | Signal names exist; **no best window or recheck-in-hours**, only `wait_days_recommended`. |
| `save_money` never overrides WAIT/LOCAL REVIEW | Implemented and tested (`fertilizer_engine.py:132-140`). |
| `content/fertilizer_practice.json`, seeded source registry | **Missing.** `backend/content/` holds `conversions.json`, `fertilizer_reference.json`, `home_remedies.json`, `sources.json`; all records arrays are empty and `sources.json` contains only `_example`. |
| Validators: source required, two-source numeric ranges, dose scanner, year plausibility, unit as printed | **Exists** (`backend/app/content_packs/loader.py:22`), but no practice schema exists for it to validate. |
| World Bank / FAOSTAT context card | **Missing.** No fetcher, no stored context JSON, no UI card. |

### Part B — Water tab

| Requirement | Current state |
|---|---|
| Separate Water navigation item | **Missing.** Tabs are `home, field, decision, trends, ask, methods` (`frontend/src/app/page.tsx:25`). |
| Water balance with `Dr`, `ETc`, `TAW`, `RAW`, `Ks`, days-to-trigger | **Exists** (`backend/water_balance.py:20-82`) with tests, and `POST /api/water-plan` (`backend/app/api/signal_routes.py:111`) returns `not_assessed` unless every input is provenance-labelled. |
| `not_assessed` with reasons | Implemented and verified live (`missing_inputs` lists all six required inputs). |
| Sources for Kc, stage length, root depth, p, AWC | **Missing.** Content packs are empty, so the endpoint must stay `not_assessed`. |
| SMAP root/surface cross-check, rain gained vs excess, 7-day outlook, net depth and litres, irrigation log, hand-check prompt, freshness clocks | **Missing from the Water surface.** `irrigation_volume_litres` exists (`water_balance.py:82`); `FarmerLogbook` records irrigation locally (`FarmerLogbook.tsx:8`) with no water-balance link. |

### Part C — data per feature

| Feature | Current state |
|---|---|
| IMERG daily `GPM_3IMERGDL` V07 | Implemented, cached, used, and fixed today for the float-equality bug. |
| IMERG half-hourly `GPM_3IMERGHHL` for window alignment | **Missing.** `grep` finds no HHR/3IMERGHH reference; `fetch_daily.py` handles daily only. |
| SMAP `SPL4SMGP` surface + root, anomaly vs same calendar window | Provider and snapshot model exist (`backend/app/signals/smap.py:24`), anomaly exists; **no HDF5/NetCDF reader** — `app/ingest/raw.py:31` only validates JSON that a human or external reader must produce. No snapshot installed. |
| POWER wetness fallback, modelled | Exists (`power_client.py`), labelled modelled. |
| Heat: POWER T2M/T2M_MAX/T2M_MIN, forecast, MODIS/VIIRS LST with QC | Air heat exists (`backend/app/signals/heat.py`); LST provider exists with `qc_good`/`clear_sky` flags (`lst.py:47`), again fed only by staged JSON, no bit-mask reader. |
| Plants: MOD13Q1/VNP13A1 NDVI+EVI with QA, HLS 30 m | Provider exists (`vegetation.py:23`) with `qa_good` gating and insufficient-clear-image state; no real reader, no HLS. |
| Terrain elevation/slope, unverified lineage | Exists via Open-Elevation + derived slope; lineage caveat documented in README. |
| Fertilizer context (World Bank/FAOSTAT) | Missing (see Part A). |
| DHM station validation and comparators | **Missing.** No `validation/` directory, no loader, no events. |

### Part D — accuracy verification

**Entirely absent.** There is no `validation/events.yaml`, no DHM CSV loader, no
station/UTC-day alignment, no metrics (bias, MAE, RMSE, r, POD/FAR/CSI), no
`accuracy-report` CLI command (see `backend/app/cli.py`), no `docs/accuracy-report.md`
or `docs/accuracy-results.json`, and no "How accurate is this data?" panel in
`ScreenEMethods.tsx`.

### Part E — tests

- Backend: 281 tests pass. They cover IMERG gates, zero-vs-missing, polygon coverage,
  provenance contracts, signal anomaly/gates, water balance, content validators and the
  new point-probe. **Missing:** checklist branches, World Bank/FAOSTAT parsing, DHM
  loader, accuracy metrics, event-config loader, report generator.
- Frontend: `test:signals` 7 pass, `test:gps` 8 pass, `test:i18n` 471 keys match,
  `lint` exit 0. **Missing:** checklist/Water-tab tests. `test:ask` and
  `test:field-survey` exist but are not part of CI (`.github/workflows/ci.yml`).
- CI runs content validation, pytest, GPS/signals/i18n tests, lint and build. No
  accuracy job, no separate type-check step.

### Part F — feature list

Present: GPS stand-and-mark with accuracy chip and point types, field map, Today
dashboard, Rain Impact, Field Signals (tiles, clocks), Stress Watch, Source Agreement,
Data Receipt, Field Diary, Trends, Ask (fixed refusal + medical referral), Nepali
default with parity test, offline cache, README.

Missing: splash reveal, pre-application checklist / spray and fertilizer modes on Today,
Water tab, Data Status UI, accuracy panel, rain confirmation loop, Replay,
low-bandwidth mode, a dedicated Stay Safe screen (only static safety copy).

## 3. Live catalog verification (NASA CMR, 2026-11-15)

| Short name | CMR version | Latest granule start (UTC) | Note |
|---|---|---|---|
| `GPM_3IMERGDL` | V07 | 2026-11-13T00:00Z | daily Late, ~2-day lag at audit time |
| `GPM_3IMERGHHL` | V07 | 2026-11-14T22:30Z | half-hourly Late is available for window alignment |
| `SPL4SMGP` | V008 | 2026-11-11T21:00Z | ~4-day lag |
| `MOD11A1` | V061 | 2026-11-14T00:00Z | Terra LST |
| `MYD11A1` | V061 | 2026-11-13T00:00Z | Aqua LST |
| `VNP21A1D` / `VNP21A1N` | V002 | 2026-11-02T00:00Z | ~13-day lag; MODIS is fresher |
| `MOD13Q1` | V061 | 2026-10-16T00:00Z | 16-day composite |
| `VNP13A1` | V002 | 2026-10-24T00:00Z | more recent composite than MOD13Q1 |

Differences to record: the code pins MODIS `MOD11A1`/`MOD13Q1` V061 for staged snapshots
while VIIRS is fresher at audit time; no code selects between products dynamically.
`docs/DATA_PROVENANCE.md` still says "V07B" while live granules are V07C.

## 4. Conflicts and risks

1. **P0 — Parts A, B and D do not exist yet.** No advisor checklist, no Water tab, no
   accuracy report. Nothing in the current UI ships these features.
2. **P0 — content packs are empty.** `validate-content` exits 0 with 0 sources and 0
   records, so CI protects a validator with no data. Any crop/soil/ET parameter must
   stay `not_assessed` until teammates enter sourced values.
3. **P0 — real readers for SMAP/LST/NDVI are missing.** The providers can only consume
   hand-produced JSON, so the live signal tiles remain `not_installed`.
4. **P1 — no half-hourly IMERG.** Event timing (Part D case 1) and spray-window
   alignment cannot be computed; the daily product cannot resolve "13:45–16:45 Nepal
   time".
5. **P1 — duplicated decision logic.** The Python engine and
   `frontend/src/lib/server/decision.ts` both carry thresholds; only the Python rules
   file is versioned and labelled.
6. **P1 — geometry never reaches the backend.** Survey points (water source, wet spot,
   steep spot) are stored on device only, so Part A items 3 and 9 cannot be evaluated
   server-side without a privacy-reviewed minimal payload.
7. **P1 — two ingestion schedulers.** Render's in-process scheduler and the GitHub
   IMERG workflow can both write; the workflow has `contents: read` and no persistence,
   so its result is discarded, while `data-publish.yml` writes a branch nothing reads.
8. **P1 — CI gaps.** `test:ask` and `test:field-survey` are not in CI; no accuracy job.
9. **P2 — stale documents.** `docs/DATA_PROVENANCE.md` says V07B; the `audit/wp0`
   branch audit describes a pre-Render deployment.
10. **P2 — stray file.** `backend/app/api/routes.py.bak` is tracked in the app package.
11. **P2 — accessibility deltas** from the earlier audit remain (11 px bottom-nav
    labels, 40 px language toggle).
12. **P2 — Nepali review markers**: 0 `// review` markers in `ne.ts`.

## 5. Positive findings

- No fabricated measurements found; missing inputs consistently produce `UNAVAILABLE`
  or `not_assessed`, never zero.
- IMERG gates are conservative (39/48 samples, 80% polygon coverage, date-gap,
  mixed-version, 5-day freshness) and the zero-vs-missing distinction is tested.
- Provenance is carried end-to-end and displayed (Data Receipt, freshness strips,
  NASA vs non-NASA labels).
- The water balance refuses to run without provenance-labelled inputs, which is exactly
  the behaviour Part B requires.
- Tests are behavioural, not smoke-only: 281 backend tests, plus signal and GPS tests.
- Today's live bug fix proves the pipeline end-to-end: IMERG V07C rainfall is now
  reported with granule IDs.

## 6. Commands run (real output)

| Command | Result |
|---|---|
| `python -m pytest -q` (backend) | `281 passed, 2 warnings in 17.21s` |
| `python -m app.cli validate-content` (backend) | `status: ok`, 0 sources, 0 fertilizer references, 0 conversions, 0 remedies |
| `node scripts/check-i18n-parity.mjs` | `471 matching keys (en.ts / ne.ts)` |
| `npm run test:signals` | `tests 7`, `pass 7`, `fail 0` |
| `npm run test:gps` | `tests 8`, `pass 8`, `fail 0` |
| `npm run lint` | exit 0 |
| CMR collection + granule queries (9 short names) | table in section 3 |
| World Bank indicator metadata `AG.CON.FERT.ZS` | Confirmed name: "Fertilizer consumption (kilograms per hectare of arable land)" |
| Live API sweep (health, districts, content, data-status, IMERG status, automation, data-storage, field-assessment, field-signals, water-plan) | All 200; rainfall `AVAILABLE`; water plan `not_assessed` |

## 7. COULD NOT VERIFY

- **DHM conventions and reference data.** No station CSVs exist, and the prompt forbids
  scraping. The accumulation window (Nepal standard time vs UTC day) is undocumented
  here.
- **FAOSTAT API.** `fenixservices.fao.org` returned HTTP 403 to this client; the dataset
  code for "Fertilizers by Nutrient" is unverified.
- **World Bank country values.** The indicator code is verified, but the Nepal data
  request timed out from this network.
- **Actual SMAP/LST/NDVI file variables and QC bit definitions** — no real granules were
  downloaded at audit time.
- **A fresh frontend production build in this run.** Earlier in the session
  `npm run build` passed; it was not re-run during this audit.
- **Which process owns scheduled ingestion in production** (Render scheduler vs GitHub
  workflow) — both exist; the Render automation status endpoint is authoritative at
  runtime.

## 8. Recommended order and effort (planning ranges, not measured)

| WP | Scope | Risk/notes | Estimate |
|---|---|---|---|
| WP1 | `fertilizer_practice` schema + seed registry, World Bank/FAOSTAT fetcher with provenance, context card | Blocked on teammate source entry for practice items | 1–1.5 d |
| WP2 | Advisor engine: three modes, 12 checklist items, ruleBasis, decision + best window + recheck | Needs hourly wind/temperature and geometry payload decision | 2–3 d |
| WP3 | Water tab backend + UI, SMAP cross-check, outlook strip, litres, irrigation log link | Needs sourced Kc/AWC content to leave `not_assessed` | 2–3 d |
| WP4 | Half-hourly IMERG fetch + window alignment, DHM CSV loader, alignment documentation | Needs Earthdata + human-supplied DHM CSVs | 1.5–2 d |
| WP5 | Accuracy metrics, `events.yaml`, report generator, in-app panel, synthetic-fixture tests | Independent of live data | 2–3 d |
| WP6 | Run the report on real data | Blocked on WP4 data; otherwise NOT RUN with exact commands | 0.5–1 d |
| WP7 | UI integration of checklist, Today modes, Water tab, i18n, accessibility | Depends on WP2/WP3 | 1.5–2 d |
| WP8 | Remaining Part F features, README, CI, deployed smoke test, judge scorecard | Missing: splash, Replay, low-bandwidth, Stay Safe screen, Data Status UI | 2–3 d |

Total: roughly 13–18 engineer-days. Critical path: WP1 → WP2 → WP7; WP3 can run in
parallel after WP1; WP4/WP5 can start immediately.

## 9. Decisions needed before WP2

1. **Hourly weather source.** Extend the Open-Meteo request with hourly `wind_speed_10m`
   and `temperature_2m` (verify exact variable names against the live API) or drop the
   hourly best-window claim.
2. **Survey-point payload.** Decide the minimal, privacy-reviewed set of on-device
   points (water source, wet spot) that may leave the phone. Radius stays avoided unless
   sourced.
3. **Single ingestion owner.** Keep the Render scheduler and disable/repurpose the GitHub
   IMERG workflow, or the reverse.

## 10. One manual action

Obtain DHM station CSVs through DHM's data request process (columns: station name,
index, latitude, longitude, elevation, timestamp with timezone, rainfall mm, accumulation
period) and place them in `validation/reference/dhm/`; also confirm the ingestion-owner
decision above. Without these, WP6 must remain NOT RUN.
