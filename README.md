# Safe Field Nepal

Safe Field Nepal is a NASA Space Apps Challenge research prototype for exploring field location, gridded weather context, predicted soil texture and cautious fertilizer-timing screening in Nepal.

## Farmer map and location selection

The map uses MapLibre GL JS with OpenFreeMap Bright as the default street basemap and an optional Esri World Imagery overlay. Farmers can select one of Nepal's 77 districts, use GPS, or tap once on the map to place a pin. Drawing a field polygon is optional and estimates area; it is not required to receive a location-based assessment. A polygon does not increase the resolution of the underlying gridded data. When a fresh GPM IMERG Late daily cache is installed, the assessment uses the nearest 0.1° (~10 km) grid cell; otherwise it falls back to the coarse NASA POWER rainfall grid (~55 km). A selected polygon does not yet produce an area-weighted IMERG field average. See [basemap terms and limitations](docs/ESRI_AND_BASEMAP_NOTES.md).

## Current assessment inputs

| Input | Provider | Role and limitation |
|---|---|---|
| Daily rainfall, air temperature, modelled wetness proxies | NASA POWER | Coarse gridded reanalysis-based data (~55 km); newest daily values may be delayed |
| Rain forecast | Open-Meteo | Non-NASA forecast; used for a short-term outlook |
| Predicted soil texture | ISRIC SoilGrids | 250 m prediction for 0–5 cm topsoil; not a field soil test |
| Elevation and slope estimate | Open-Elevation API | Underlying DEM lineage/resolution are not verified by this integration |

GPM IMERG Late is an optional cached rainfall input. GPM IMERG Final, SMAP and NASADEM are **not connected** to the current field-assessment endpoint.

## Decision engine status

The engine is deterministic and explainable, but its rainfall, texture and slope cut-offs are prototype design assumptions pending review by Nepalese agronomists. The current labels are:
- `CONDITIONS LOOK SUITABLE`
- `WAIT AND RECHECK`
- `LOCAL REVIEW NEEDED`

These are screening labels, not fertilizer application instructions, rates or safety certifications. Missing inputs remain unavailable and trigger local review. The legacy `save_money` preference does not change warnings or decisions. A farmer-provided sand-fraction override can be passed to the assessment.

## Run locally

Backend:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Frontend:

```powershell
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`. Configure `NEXT_PUBLIC_API_BASE_URL` when the backend is not running at the default local URL.

## Tests

```powershell
cd backend
pytest
```

## Project documentation

- [Data provenance and limitations](docs/DATA_PROVENANCE.md)
- [Prototype decision-rule register](docs/RULE_REGISTER.md)
- [Farmer handling safety](docs/FARMER_SAFETY.md)
- [Scientific and field validation plan](docs/VALIDATION_PLAN.md)
- [GPM IMERG integration status](docs/IMERG_INTEGRATION_STATUS.md)
- [Nepal farmer-health evidence status](docs/RESEARCH_EVIDENCE_STATUS.md)
- [Mobile usability requirements](docs/MOBILE_USABILITY.md)
- [Basemap provider notes](docs/ESRI_AND_BASEMAP_NOTES.md)
- [Judge demonstration checklist](docs/DEMO_AND_JUDGE_CHECKLIST.md)

## Responsible use

This is an educational research prototype, not formal agronomic advice. Check the fertilizer product label, a soil test and local agricultural extension guidance. Verify important conditions on the ground. Do not infer a fertilizer dose from this app.

## Validation still required

The repository does not claim completed farmer trials, expert sign-off, Nepal-specific farmer-health study validation, real-device acceptance testing, or production readiness. See the validation plan before making those claims.


## Safe Field data setup and manual tasks

### 1. Install IMERG Late rainfall data

Create a root `.env` from `.env.example` and enter your NASA Earthdata Login credentials as `EARTHDATA_USERNAME` and `EARTHDATA_PASSWORD`. Never commit `.env`. From the `backend` directory, install requirements and run the one fetch command:

```bash
python -m pip install -r requirements.txt
python -m app.cli fetch-imerg --days 7
```

The command downloads only outside API request handling and writes Nepal-cropped daily GPM_3IMERGDL grid cells to the local SQLite cache. See [IMERG fetch instructions](backend/docs/IMERG_FETCH.md). Live Earthdata authentication and upstream availability must be checked locally.

### 2. Add researched farmer guidance

Drop source records into `backend/content/sources.json`, and researched fertilizer references, verified conversions and home remedies into the corresponding JSON files. Keep the `_example` keys as templates; the loader ignores them. Run:

```bash
cd backend
python -m app.cli validate-content
```

Only records with verified provenance are eligible. Fertilizer reference ranges require an official source and are displayed as source references, not personalized prescriptions. Non-official remedy quantities are hidden. Free-text remedy fields reject dose-like expressions. The API exposes validation counts at `GET /api/content-status`.

### Data use and limitations

- NASA POWER is a coarse gridded reanalysis-based data source; it is not an on-farm sensor.
- GPM IMERG Late is a separate ~0.1° daily precipitation product. The local grid cache is not a field-boundary average.
- Open-Meteo is a non-NASA forecast; SoilGrids is a non-NASA modeled soil estimate; elevation lineage remains unverified.
- The decision engine is a prototype screening aid, not an agronomist-approved recommendation or safety certification.
- **Independent project, not endorsed by NASA.**

AI-use disclosure: generative AI assistance was used during software implementation and documentation; scientific source records and local agronomic content must be independently researched and reviewed before publication.
