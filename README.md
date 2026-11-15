<p align="center">
  <img src="aassets/SFD.png" alt="Safe Field Nepal logo" width="500" />
</p>

<p align="center">
  Making agricultural data easier to understand, one field at a time.
</p>

<p align="center">
  A Nepal-focused agricultural research prototype built for the
  <a href="https://www.spaceappschallenge.org/2026/challenges/field-shift-adapting-farms-with-nasa-data/">NASA Space Apps Challenge 2026</a>.
</p>

<p align="center">
  <img alt="NASA Space Apps Challenge 2026" src="https://img.shields.io/badge/NASA%20Space%20Apps-2026-0B5FFF?style=flat-square" />
  <img alt="Project status" src="https://img.shields.io/badge/status-research%20prototype-orange?style=flat-square" />
  <img alt="Interface languages" src="https://img.shields.io/badge/languages-English%20%7C%20Nepali-168B5B?style=flat-square" />
</p>

---

## Why We Built Safe Field Nepal

Farmers make important decisions based on rainfall, soil conditions, weather and the changing environment. However, useful environmental information is often spread across different sources and can be difficult to interpret at an individual farm level.

We chose this project because we wanted to explore how satellite observations and open environmental data could become easier for Nepalese farmers to access and understand. Safe Field Nepal brings available rainfall information, weather forecasts, soil-texture estimates and terrain context together in one location-aware platform.

Our goal is simple: farmers should not need to understand complex satellite datasets to explore information about their land. The application presents available evidence in a more approachable way, while showing its source, date, freshness and limitations.

- **Live prototype:** https://safefieldnp.netlify.app
- **Project presentation:** https://canva.link/oef8hx002ollo33

The interface supports **English and Nepali**, switched with an `EN | ने` toggle in the top bar. The choice is remembered on the device.

## What It Can Do

The app is **field-first**. The map opens on a Nepal overview with no pre-selected location, and the assessment and Ask assistant stay gated until the farmer marks their own land. There is no default town or farm shown on the map.

A farmer can mark a field in the way that fits the situation:

1. **Tap the map** at the field location (the pin can be dragged to adjust it).
2. **Use GPS** while standing in the field — the app can average several readings and reports the estimated error, rather than trusting a single fix.
3. **Walk the field corners** — record a corner at each stop to build a boundary.
4. **Draw the boundary** point by point and finish it to see an approximate area.
5. **Search a place or district** when the farmer is not physically at the field yet.

Only after a field is marked does the app load or show data for it. Selecting a new location clears the previous assessment instead of carrying stale numbers across.

After selecting a location, the prototype can help users explore:

- **Field mapping:** Find a location, mark a point and optionally draw a field boundary.
- **Rainfall information:** Explore recent rainfall estimates using NASA GPM IMERG data when a fresh local cache is available, with a fallback to Open-Meteo past-days reanalysis where supported.
- **Weather forecasts:** View short-term forecasts from Open-Meteo, identified separately from NASA data.
- **Soil information:** Explore estimated sand, silt and clay fractions from ISRIC SoilGrids.
- **Terrain context:** View elevation and estimated slope information.
- **Climate trends:** Explore historical heavy-rain-day frequency using NASA POWER records.
- **Environmental screening:** Review a preliminary screening result based on available rainfall, forecast, soil-texture, wetness and slope inputs.
- **Ask about this field:** Ask plain-language questions about the current field, with answers grounded in the data shown in the app.
- **Read aloud:** Every Ask answer can be spoken in the selected language using the device's speech synthesis, so a farmer can listen instead of reading.
- **Farm records:** Record crop setup, field activities, irrigation and farmer-entered observations.
- **Offline awareness:** Use a recent browser-cached assessment when offline, while retaining its original timestamps and identifying it as cached information.

The screening result uses labels such as `CONDITIONS LOOK SUITABLE`, `WAIT AND RECHECK` and `LOCAL REVIEW NEEDED`. These are preliminary screening labels, not fertilizer instructions or guarantees about field conditions.

## Is It Designed for Farmers?

Yes. Farmer accessibility is one of the main reasons for building the project. The workflow starts with familiar actions: mark the land on a map, use the phone's location while standing in the field, or walk the field corners. Users do not need to configure scientific datasets themselves.

The interface is mobile-first and designed to keep information understandable through clear labels, visible measurements and explanations of where the data comes from. English and Nepali language support is included to make the experience more accessible in Nepal, and answers can be read aloud.

We want Safe Field Nepal to become a practical tool that farmers can use to explore their land and make more informed decisions—not a complicated scientific dashboard.

However, being designed for farmers does not yet mean that farmer usability has been proven. This is a research prototype, and its ease of use and practical value still need to be evaluated with local farmers and agricultural experts. Feedback from real users will help us improve the language, location-selection workflow, map experience and way information is presented.

## How It Works

Safe Field Nepal combines several environmental and geospatial sources. Each source has different coverage, resolution and update timing, so the application aims to show data provenance and limitations rather than presenting every value as a direct field measurement.

| Data source | How it is used |
|---|---|
| [NASA GPM IMERG](https://gpm.nasa.gov/data/imerg) | Recent rainfall grid when a fresh local cache is available |
| [NASA POWER](https://power.larc.nasa.gov/) | Historical and regional climate context |
| [Open-Meteo](https://open-meteo.com/) | Short-term weather forecast and past-days rainfall fallback |
| [ISRIC SoilGrids](https://soilgrids.org/) | Predicted soil-texture fractions |
| [Open-Meteo Elevation API](https://open-meteo.com/en/docs/elevation-api) | Elevation context, using Copernicus DEM GLO-90 as its primary dataset |
| [OpenFreeMap](https://openfreemap.org/) and [Esri World Imagery](https://www.esri.com/) | Map display and optional imagery layer |

Every number in the interface carries provenance: source, kind (observation, model, forecast, fallback, cached or farmer input), the date it is valid for, and whether it is NASA data. Fallback and cached values are never presented as live observations.

The current assessment API is geographically bounded to Nepal coordinates between **26.3–30.5° N** and **80.0–88.3° E**. The API identifies Morang, Sunsari, Jhapa and Ilam as pilot districts.

## Repository Layout

```
backend/                 FastAPI service, data ingest, cache and automation
  app/api/               Assessment and signal endpoints
  app/services/imerg/    IMERG granule download and grid cache
  app/ingest/            Snapshot ingest, retention pruning, scheduler
  app/cache/             SQLite cache with TTLs
  tests/                 pytest suite
  .env.example           Copy to backend/.env and fill credentials
frontend/                Next.js app (dashboard, map, Ask assistant, i18n)
  src/app/               App shell and assessment API route
  src/components/        Screens, dashboard cards, assistant
  src/lib/               Map, signals, geometry, GPS averaging
  scripts/               Data prep and content tests
docs/                    Provenance, safety, validation and method notes
```

## Built With

| Layer | Technologies |
|---|---|
| Frontend | Next.js, React, TypeScript, Tailwind CSS |
| Maps and visualisation | MapLibre GL JS, Recharts, Lucide React |
| Backend API | Python, FastAPI, Pydantic, Uvicorn |
| Scientific analysis | NumPy, SciPy, pymannkendall, statsmodels |
| Geospatial processing | earthaccess, xarray, netCDF4, Shapely, pyproj |
| Data cache | SQLite |

## Getting Started

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env             # then fill in your own values
uvicorn app.main:app --reload
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The frontend expects the API at `NEXT_PUBLIC_API_BASE_URL` (default `http://127.0.0.1:8000`).

## Automatic Data Refresh and Retention

The backend can keep its local satellite cache current without manual steps. When the API starts and `DATA_REFRESH_ENABLED` is not `false`, a background scheduler:

1. waits `DATA_REFRESH_STARTUP_DELAY_SECONDS` (default 60 s) so startup stays fast;
2. installs the most recently published NASA GPM IMERG Late daily granules for the last `IMERG_REFRESH_DAYS` completed UTC days (default 3), skipping dates already installed;
3. only after the new data is installed, deletes data that is outside the retention windows;
4. repeats every `DATA_REFRESH_INTERVAL_HOURS` (default 6 h).

A file lock prevents two refreshes from running at once, and the last result is written atomically to `backend/data/automation-status.json` (runtime state, gitignored). The status file records what was installed, what was pruned and any error, but never credentials, file paths or precise coordinates.

### Credentials

NASA Earthdata credentials belong in **`backend/.env`**, which is gitignored:

```
EARTHDATA_USERNAME=your_username
EARTHDATA_PASSWORD=your_password
# EARTHDATA_TOKEN=...          # optional alternative to username/password
```

For GitHub Actions, add them as repository secrets `EARTHDATA_USERNAME` and `EARTHDATA_PASSWORD`. The workflow `.github/workflows/imerg-refresh.yml` runs daily at 02:25 UTC and can also be started manually; if the secrets are missing it reports that and skips the install rather than failing silently.

Never commit credentials, paste them into issues, or place them in source files.

### Retention windows

| Setting | Default | What it removes |
|---|---|---|
| `IMERG_RETENTION_DAYS` | 30 | IMERG grid cells and raw granules older than this |
| `API_CACHE_RETENTION_DAYS` | 30 | Cached live API responses older than this |
| `SIGNAL_RETENTION_DAYS` | 120 | Installed satellite snapshots and staged raw files older than this |

The pruning runs in the same job as the install, so old data is replaced gradually instead of accumulating. Data inside the window is kept; nothing is deleted before new data has been written.

### Manual commands

```bash
cd backend
python -m app.cli refresh-data              # install new IMERG days, then prune
python -m app.cli refresh-data --days 7     # check a wider recent window
python -m app.cli refresh-data --no-prune   # install only
python -m app.cli automation-status         # last automatic refresh result
python -m app.cli automation-status --json  # machine-readable
python -m app.cli status                    # installed snapshot state
```

### What is automated, honestly

Only **NASA GPM IMERG rainfall** is downloaded automatically. A verified raw snapshot placed in `backend/data/incoming/<source>/YYYY-MM-DD.json` (or restored from Supabase Storage) is installed automatically by the same refresh job. This repository does **not** ship numeric readers for SMAP, land-surface temperature or NDVI/EVI granules, so it never downloads or invents those values itself; until a verified reader stages them, the interface reports the signal as unavailable. Missing data is never replaced with another product. If Earthdata credentials are absent, the refresh records `skipped_no_credentials` and the app keeps whatever it already has, clearly labelled by age.

## Optional Supabase Storage

SQLite and the local `backend/data/` directories remain the default and work with no cloud account. Setting Supabase values in `backend/.env` moves the cached data into a Supabase project so the backend no longer depends on one server's disk.

| Data | Where it goes | Notes |
|---|---|---|
| Cached live API responses, IMERG grid cells | Supabase Postgres, private `safefield` schema | Tables are created automatically; `SUPABASE_DB_URL` |
| Satellite snapshots, staged provider JSON, raw IMERG granules, `status.json` | Supabase Storage bucket (`safefield-data`) | Private bucket, created on first run; `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` |

Setup:

1. In Supabase, open **Project Settings → Database** and copy the Postgres connection string into `SUPABASE_DB_URL` (append `?sslmode=require` if it is not already present).
2. Copy the project URL into `SUPABASE_URL` and the **service-role** key into `SUPABASE_SERVICE_ROLE_KEY`. The service-role key is server-side only: it must never be exposed to the frontend, logged, or committed.
3. Keep `SUPABASE_STORAGE_BUCKET=safefield-data` or choose another name.
4. Restart the backend.

Behaviour:

- The cache backend keeps the same interface and SQL as the SQLite cache, so no API route changes.
- Tables live in a separate `safefield` schema, not `public`. Supabase's PostgREST API exposes only `public`, so the anon key cannot read the cache.
- On startup the backend creates the tables and bucket if needed, restores missing files, and reports readiness at `GET /api/integrations/data-storage`. Startup still succeeds if Supabase is temporarily unreachable; the next refresh retries.
- The local disk is still the fast read/write path. After a refresh, files are mirrored up; on startup, missing snapshots, staged JSON and `status.json` are restored from Storage (`SUPABASE_RESTORE_ON_STARTUP=false` disables the file restore). Raw IMERG granules are mirrored but not auto-restored because they can be re-downloaded.
- The same retention windows apply remotely: expired files are deleted from the bucket in the refresh job.
- Storage failures are reported as `status: error` in the automation status and turn the run `partial`; they never hide a successful install. Error messages include the HTTP status and object path, never the key.
- Field boundaries are still never uploaded. Only provider/satellite data is stored.

Manual commands:

```bash
cd backend
python -m app.cli storage-check            # create/verify tables and bucket, print redacted status
python -m app.cli storage-sync             # mirror local data files up
python -m app.cli storage-sync --force     # re-upload even when sizes match
python -m app.cli storage-restore          # restore missing snapshots/staged JSON/status.json
```

For GitHub Actions, add `SUPABASE_DB_URL`, `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as repository secrets; the workflow passes them through when they exist.

## Tests and Quality Gates

```bash
# Backend
cd backend && python -m pytest

# Frontend
cd frontend
npm run lint
npx tsc --noEmit
npm run test:i18n          # English/Nepali key parity
npm run test:signals       # provenance and signal rules
npm run test:gps           # GPS quality averaging
npm run test:field-survey  # boundary and GPS tests
npm run build
```

The content validator (`python -m app.cli validate-content`) checks the source and farmer-guidance JSON files.

## Deployment

- **Netlify (current):** https://safefieldnp.netlify.app serves the current dashboard build.
- **Vercel:** the `safefieldnp.vercel.app` project currently serves an earlier build. Its Git connection and production branch need to be corrected in the Vercel dashboard before it will reflect this repository.

The frontend can be built with `npm run build` and served by any Node host. The backend works with no cloud account on a host with a persistent disk for the SQLite cache and IMERG files. With the optional Supabase settings above, cached data and data files live in Supabase instead, so an ephemeral disk is enough.

### Render backend

`render.yaml` is a blueprint for a Python web service running `backend/` with `/api/health` as its health check. If the service already exists, add the same variables in **Render → your service → Environment** instead of creating a new blueprint.

| Variable | Purpose |
|---|---|
| `EARTHDATA_USERNAME`, `EARTHDATA_PASSWORD` | NASA Earthdata Login used by the automatic IMERG refresh (mark as secret) |
| `SUPABASE_DB_URL` | Supabase Postgres connection string for the API cache and IMERG cells (mark as secret) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase Storage URL and service-role key (mark the key as secret) |
| `SUPABASE_STORAGE_BUCKET` | Bucket name, default `safefield-data` |
| `DATA_REFRESH_ENABLED` | `true` to run the in-process scheduler |
| `IMERG_RETENTION_DAYS`, `API_CACHE_RETENTION_DAYS`, `SIGNAL_RETENTION_DAYS` | How long data is kept before automatic deletion |

On first start the backend creates the Postgres tables and the private bucket, then restores files. The scheduler then installs newly published IMERG days, ingests any staged snapshots, deletes data outside the retention windows locally, in Postgres and in Storage, and mirrors the result back to Supabase. Confirm the wiring with `GET /api/integrations/data-storage`.

Render's free web instances sleep when idle, which pauses the in-process scheduler; the next request wakes the service and the scheduled refresh resumes. For updates while the service is idle, either use an always-on instance or keep the GitHub Actions workflow enabled with the same Supabase and Earthdata repository secrets.

## Current Scope and Limitations

Safe Field Nepal is an **educational research prototype**, not a validated agronomic advisory service.

The current working prototype focuses on field location, environmental context, rainfall and weather evidence, climate-trend exploration and cautious fertilizer-timing screening. It does **not yet generate, rank or compare crop-rotation plans**. That would require additional crop-calendar and rotation data, farmer-priority inputs, locally reviewed agronomic rules and field validation.

Some important limitations:

- Screening thresholds are preliminary design assumptions and have not yet been validated by Nepalese agronomists.
- Satellite and gridded datasets cover areas much larger than an individual farm. Drawing a field boundary does not increase the resolution of the underlying data.
- SoilGrids provides modelled estimates, not laboratory soil-test results.
- NASA POWER wetness variables are modelled proxies, not direct soil-moisture sensor measurements.
- Forecasts and reanalysis products have uncertainty and must be distinguished from observations.
- GPS accuracy on a phone varies with terrain, canopy and hardware; averaged readings reduce random noise but not systematic error.
- Farmer-entered records are user-provided information, not independently verified measurements.
- The project has not yet established completed farmer trials, expert sign-off, real-device acceptance testing or production readiness.
- The prototype does not calculate fertilizer doses or provide validated fertilizer application instructions.

Farmers should verify field conditions locally, use appropriate soil tests and consult local agricultural extension services before making important farming decisions.

For further details, see the [validation plan](docs/VALIDATION_PLAN.md).

## Privacy and Data Handling

- Field geometry stays in the browser on the farmer's device. It is not stored on the server.
- API requests use rounded coordinates, and application logs do not contain precise field coordinates.
- Language choice and session state are kept in browser local storage.
- Credentials are read only from environment variables or repository secrets.

## Acknowledgements

Developed for the **NASA Space Apps Challenge 2026**, under the challenge **Field Shift: Adapting Farms with NASA Data**.

We acknowledge NASA and the open-data organisations that provide the scientific and geospatial datasets used by this prototype.

Safe Field Nepal is an independent team project. It is **not affiliated with, produced by or endorsed by NASA**. NASA data and logos remain subject to their respective source and usage terms.

---

<p align="center">
  <img src="aassets/image.png" alt="Safe Field Nepal" width="400" />
</p>

<p align="center">
  Better information. Smarter decisions. Stronger farming communities.
</p>
