# Safe Field Nepal

Safe Field Nepal is a NASA Space Apps Challenge research prototype for exploring field location, gridded weather context, predicted soil texture and cautious fertilizer-timing screening in Nepal.

## Current assessment inputs

| Input | Provider | Role and limitation |
|---|---|---|
| Daily rainfall, air temperature, modelled wetness proxies | NASA POWER | Coarse gridded reanalysis-based data (~55 km); newest daily values may be delayed |
| Rain forecast | Open-Meteo | Non-NASA forecast; used for a short-term outlook |
| Predicted soil texture | ISRIC SoilGrids | 250 m prediction for 0–5 cm topsoil; not a field soil test |
| Elevation and slope estimate | Open-Elevation API | Underlying DEM lineage/resolution are not verified by this integration |

GPM IMERG, SMAP and NASADEM are **not connected** to the current field-assessment endpoint. Do not present them as active decision inputs.

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
