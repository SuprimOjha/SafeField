# Prototype decision-rule register

**Status: NOT AGRONOMICALLY VALIDATED.** Every numeric cut-off in `backend/app/decision/rules.json` is a design assumption pending review by Nepalese agronomists. No FAO or NARC source has yet been attached to each threshold.

| Rule input | Prototype cut-off | Intended screening purpose | Evidence status |
|---|---:|---|---|
| Recent rainfall | 15 mm | Flag possible rain-related nutrient movement | Design assumption; pending expert review |
| Forecast rainfall | 10 mm / 48 h | Flag possible incoming rain | Design assumption; Open-Meteo is non-NASA |
| Sand fraction | 55% | Flag possible leaching context | Design assumption; SoilGrids prediction is coarse |
| Slope | 8% | Flag possible runoff context | Design assumption; elevation lineage/resolution unverified |

The thresholds do not specify fertilizer rates, nutrient requirements, crop-specific schedules or safe handling conditions. The engine must not issue a direct application command.

## Cost preference
The `save_money` preference is recorded for transparency but must not alter timing, warnings, nutrient rate or decision signal. It must never encourage under-application.

## Required validation before operational use
1. Review every threshold with NARC or qualified Nepalese agronomists.
2. Validate by crop, fertilizer formulation, growth stage, soil and irrigation context.
3. Compare prototype outputs with field observations and extension recommendations.
4. Document false-positive and false-negative behavior.
5. Do not promote a rule to evidence-based status without a traceable source and review record.
