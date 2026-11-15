# Safe Field Nepal — Copilot instructions

## Project and workflow
Safe Field Nepal is a decision-support research prototype for Nepali smallholder farmers (NASA Space Apps 2026). The frontend is Next.js, TypeScript, Tailwind and MapLibre in `frontend/`; the backend is FastAPI, Pydantic, httpx, SQLite, NumPy/SciPy, Shapely/pyproj and earthaccess in `backend/`.

Extend existing components, API contracts and data pipelines. Do not remove working features, rename or remove API fields, or rewrite subsystems without explicit approval. Keep changes small, reviewable and tested. Do not add dependencies without a one-line justification.

## Non-negotiable data and safety rules
1. Never invent measurements, data, sources, dates, versions, doses, prices, yields, accuracy figures or test results. Missing values remain null and visibly unavailable. Never put mock data in the product or a real cache.
2. Every API number must carry provenance: source, product, version read from the data (never assumed), kind (`observation | model | forecast | fallback | cached | farmer_input | assumption`), valid dates, resolution when known, NASA true/false, and latency note.
3. Label sources truthfully: GPM IMERG is a NASA observation; NASA POWER is NASA modeled data (wetness is a modeled proxy, not SMAP); Open-Meteo, SoilGrids, Open-Elevation and FAO are non-NASA.
4. Do not provide fertilizer or pesticide doses, mixing ratios or product names. Never describe a product or condition as “safe”, “best” or guaranteed. Keep “Follow the product label” near application advice and “Not yet reviewed by a Nepali agronomist” until a review record exists.
5. Every threshold/rule must cite a source using a `sourceKey` from `content/sources.json`, or be explicitly marked as an assumption. User-facing assumption wording: “design assumption, pending expert review”. Tunable values belong in config, not inline.
6. Never loosen validation or quality gates to make data pass.
7. Secrets belong only in environment variables or repository secrets (`EARTHDATA_USERNAME`, `EARTHDATA_PASSWORD`). Never commit, log or print them.
8. Field geometry stays on-device. API requests use rounded coordinates. Logs must never contain precise coordinates.
9. Preserve backward compatibility: add fields, do not rename or remove. Delete dead code introduced by your change.
10. Every change ships with tests. Run and report real output for backend `pytest`, backend lint, `python -m app.cli validate-content` when available, frontend lint, typecheck, tests and production build. Say “could not run” when a command cannot be executed. Never claim unrun checks passed.
11. If network access or credentials are unavailable, do not bypass restrictions or fabricate results. Implement against fixtures and list the live checks a human must perform.

## Scientific semantics
- GPM IMERG Late daily (`GPM_3IMERGDL`) represents a completed UTC day and is published about 14 hours after day close. Nepal is UTC+5:45; the latest available value is typically 14–38 hours old. Always display the covered UTC day. Never call it “today” or a forecast.
- A complete IMERG day contains 48 half-hour samples. Preserve existing 80% coverage, NaN/negative/infinite rejection, mixed-version rejection and zero-versus-missing gates.
- NASA POWER fill value -999 is null. Open-Meteo parallel arrays align by index with `daily.time`.
- Satellite rainfall is roughly 10 km; drawing a field polygon does not improve source resolution.

## Farmer-first interface
- Mobile-first at 360 px; content max width 1100 px. Default language Nepali with English toggle. Every string is localized in `src/i18n/en.ts` and `src/i18n/ne.ts`; keep key parity and mark uncertain Nepali strings `// review`.
- Use Noto Sans Devanagari with system fallback. Body 18 px; secondary text at least 16 px; touch targets at least 48 px. Meet WCAG AA; visible focus, keyboard support, status icon + word + color (never color alone), reduced-motion support.
- Farmer path stays plain and non-technical. Put technical details in Data Receipt and Methods. Represent loading, empty, error/retry, offline/data age, unavailable and not-assessed states.
- Keep data provenance visible for every number. Distinguish observed, modeled, forecast, cached, fallback and farmer-entered values.
- Do not use emojis in Nepali read-aloud content. Use lucide-react line icons.

## Before finishing
Report: Changes made; commands run with real output; tests added; NOT changed; COULD NOT VERIFY; one manual step for the team. Do not mark a work order complete until the implementation and checks have been inspected.
