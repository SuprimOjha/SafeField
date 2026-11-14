import json
from pathlib import Path
from typing import Literal
from pydantic import BaseModel
from app.services.rainfall import RainfallObservation


DecisionSignal = Literal["CONDITIONS LOOK SUITABLE", "WAIT AND RECHECK", "LOCAL REVIEW NEEDED"]
ConfidenceLevel = Literal["MODERATE", "CAUTION"]


class RuleContribution(BaseModel):
    parameter: str
    observed_value: str
    impact: Literal["FAVORABLE", "RISKY", "NEUTRAL"]
    explanation: str
    evidence_status: str = "DESIGN ASSUMPTION — PENDING EXPERT REVIEW"


class DecisionResult(BaseModel):
    signal: DecisionSignal
    confidence: ConfidenceLevel
    wait_days_recommended: int
    primary_reason: str
    detailed_explanation: str
    rule_contributions: list[RuleContribution]
    disclaimer: str = (
        "Research prototype only. Thresholds are design assumptions pending review by "
        "Nepalese agronomists. Check the fertilizer product label, soil test and local "
        "agricultural extension advice. This is not a safety certification or application rate."
    )


class FertilizerDecisionEngine:
    """Deterministic prototype rules; thresholds are not validated agronomic advice."""

    def __init__(self) -> None:
        rules_path = Path(__file__).parent / "rules.json"
        self.rules = json.loads(rules_path.read_text(encoding="utf-8")).get("thresholds", {}) if rules_path.exists() else {}

    def evaluate_timing(
        self,
        rain_last_72h_mm: float | None,
        expected_rain_next_48h_mm: float | None,
        soil_wetness: float | None,
        sand_percent: float | None,
        slope_percent: float | None,
        fertilizer_type: str,
        crop_stage: str,
        priority_save_money: bool,
        rainfall_observation: RainfallObservation | None = None,
    ) -> DecisionResult:
        if rainfall_observation is not None:
            rain_last_72h_mm = rainfall_observation.amount_mm if rainfall_observation.status == "AVAILABLE" else None
        t = self.rules
        contributions: list[RuleContribution] = []
        inputs = {
            "Recent rainfall (nominal 72h)": rain_last_72h_mm,
            "Open-Meteo forecast (48h)": expected_rain_next_48h_mm,
            "NASA POWER modeled surface wetness": soil_wetness,
            "SoilGrids predicted sand fraction": sand_percent,
            "Elevation-derived slope": slope_percent,
        }
        missing = [name for name, value in inputs.items() if value is None]
        if rainfall_observation is not None:
            if rainfall_observation.provenance is None:
                rainfall_detail = "Rainfall source unavailable; no provenance supplied."
            else:
                source = rainfall_observation.provenance
                rainfall_detail = f"{source.source_name}; dataset={source.dataset} version={source.version} stream={source.stream}; kind={source.kind}; spatial_method={source.spatial_method}; coverage_fraction={source.coverage_fraction}; observed {source.observed_start_utc.isoformat()} to {source.observed_end_utc.isoformat()}; fetched {source.fetched_at_utc.isoformat()}."
            contributions.append(RuleContribution(
                parameter="Rainfall provenance",
                observed_value="Unavailable" if rainfall_observation.amount_mm is None else f"{rainfall_observation.amount_mm} mm over {rainfall_observation.window_hours} hours",
                impact="NEUTRAL",
                explanation=rainfall_detail,
                evidence_status="SOURCE PROVENANCE — NUMERIC SCREENING THRESHOLD PENDING EXPERT REVIEW",
            ))
        for name, value in inputs.items():
            contributions.append(RuleContribution(
                parameter=name,
                observed_value="Unavailable" if value is None else str(value),
                impact="NEUTRAL" if value is None else "FAVORABLE",
                explanation="No value was supplied; this input is not treated as zero or as favorable." if value is None else "Observed/modelled input is available; its threshold remains an unvalidated prototype assumption.",
            ))

        if missing:
            return DecisionResult(
                signal="LOCAL REVIEW NEEDED",
                confidence="CAUTION",
                wait_days_recommended=0,
                primary_reason="There is not enough reliable data to assess application timing.",
                detailed_explanation="Unavailable inputs: " + ", ".join(missing) + ". Do not interpret missing values as zero rainfall, dry soil or safe conditions. Check local conditions and consult an agricultural technician.",
                rule_contributions=contributions,
            )

        assert rain_last_72h_mm is not None
        assert expected_rain_next_48h_mm is not None
        assert soil_wetness is not None
        assert sand_percent is not None
        assert slope_percent is not None

        heavy_forecast = expected_rain_next_48h_mm >= t.get("forecast_rain_heavy_mm", 10.0)
        recent_heavy = rain_last_72h_mm >= t.get("recent_rain_heavy_mm", 15.0)
        if heavy_forecast or recent_heavy:
            contributions.append(RuleContribution(
                parameter="Rain-related caution",
                observed_value=f"recent={rain_last_72h_mm} mm; forecast={expected_rain_next_48h_mm} mm",
                impact="RISKY",
                explanation="Prototype threshold indicates a reason to pause and recheck local weather and field conditions.",
            ))
            signal: DecisionSignal = "WAIT AND RECHECK"
            wait_days = 2 if heavy_forecast else 1
            primary = "Rain-related conditions suggest waiting and checking again."
            detail = "This is a conservative screening flag, not a validated fertilizer schedule. Reassess after the rain event and follow the product label and local extension advice."
        elif slope_percent >= t.get("slope_steep_pct", 8.0) or sand_percent >= t.get("sandy_soil_sand_pct", 55.0):
            contributions.append(RuleContribution(
                parameter="Field loss-risk screening",
                observed_value=f"sand={sand_percent}%; slope={slope_percent}%",
                impact="RISKY",
                explanation="Texture and slope may affect nutrient movement; the numeric cut-offs are design assumptions pending expert review.",
            ))
            signal = "LOCAL REVIEW NEEDED"
            wait_days = 0
            primary = "Local soil and field review is recommended before deciding."
            detail = "Do not infer a smaller fertilizer dose from this screen. Confirm crop nutrient needs, soil test results and recommended application rates with a local technician."
        else:
            signal = "CONDITIONS LOOK SUITABLE"
            wait_days = 0
            primary = "The available indicators do not trigger the prototype's rain or terrain cautions."
            detail = "This does not establish that fertilizer is needed or that application is safe. Check the product label, crop-specific recommendation, soil test and local conditions."

        # The cost-priority flag is intentionally non-operative: it must never reduce
        # a recommended rate, suppress a warning, or alter this prototype's signal.
        contributions.append(RuleContribution(
            parameter="Save-money preference",
            observed_value="Selected" if priority_save_money else "Not selected",
            impact="NEUTRAL",
            explanation="This preference does not change timing, nutrient rate, warnings or the decision signal.",
            evidence_status="USER PREFERENCE ONLY — NO DECISION EFFECT",
        ))
        return DecisionResult(
            signal=signal,
            confidence="CAUTION",
            wait_days_recommended=wait_days,
            primary_reason=primary,
            detailed_explanation=detail,
            rule_contributions=contributions,
        )
