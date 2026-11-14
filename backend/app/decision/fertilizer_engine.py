import json
from pathlib import Path
from typing import Literal
from pydantic import BaseModel


DecisionSignal = Literal["APPLY NOW", "WAIT", "APPLY IN SMALLER SPLITS"]
ConfidenceLevel = Literal["HIGH", "MODERATE", "CAUTION"]


class RuleContribution(BaseModel):
    parameter: str
    observed_value: str
    impact: Literal["FAVORABLE", "RISKY", "NEUTRAL"]
    explanation: str


class DecisionResult(BaseModel):
    signal: DecisionSignal
    confidence: ConfidenceLevel
    wait_days_recommended: int
    primary_reason: str
    detailed_explanation: str
    rule_contributions: list[RuleContribution]
    disclaimer: str = "Decision support based on NASA satellite observations and cited agronomic rules. Not formal agronomic advice."


class FertilizerDecisionEngine:
    """
    Transparent rule-based fertilizer timing decision engine.
    No LLM is used for numbers or signals; all evaluations are deterministic.
    """

    def __init__(self) -> None:
        rules_path = Path(__file__).parent / "rules.json"
        if rules_path.exists():
            with open(rules_path, "r", encoding="utf-8") as f:
                self.rules = json.load(f).get("thresholds", {})
        else:
            self.rules = {
                "recent_rain_heavy_mm": 15.0,
                "recent_rain_moderate_mm": 5.0,
                "forecast_rain_heavy_mm": 10.0,
                "soil_wetness_high": 0.70,
                "soil_wetness_low": 0.30,
                "slope_steep_pct": 8.0,
                "sandy_soil_sand_pct": 55.0,
            }

    def evaluate_timing(
        self,
        rain_last_72h_mm: float,
        expected_rain_next_48h_mm: float,
        soil_wetness: float,
        sand_percent: float,
        slope_percent: float,
        fertilizer_type: str,  # "Urea", "DAP", "Compost/FYM"
        crop_stage: str,       # "Basal / Planting", "Vegetative / Tillering", "Flowering / Grain Filling"
        priority_save_money: bool,
    ) -> DecisionResult:
        t = self.rules
        contributions: list[RuleContribution] = []

        # Evaluate recent rain
        if rain_last_72h_mm >= t["recent_rain_heavy_mm"]:
            contributions.append(
                RuleContribution(
                    parameter="Recent Rainfall (72h)",
                    observed_value=f"{rain_last_72h_mm} mm",
                    impact="RISKY",
                    explanation="Heavy rain in the last 72 hours means soil is saturated; applying now risks severe runoff/leaching.",
                )
            )
        else:
            contributions.append(
                RuleContribution(
                    parameter="Recent Rainfall (72h)",
                    observed_value=f"{rain_last_72h_mm} mm",
                    impact="FAVORABLE",
                    explanation="Recent rainfall is moderate or low, providing adequate baseline soil moisture for nutrient uptake.",
                )
            )

        # Evaluate 48h forecast rain
        if expected_rain_next_48h_mm >= t["forecast_rain_heavy_mm"]:
            contributions.append(
                RuleContribution(
                    parameter="2-Day Rain Forecast",
                    observed_value=f"{expected_rain_next_48h_mm} mm expected",
                    impact="RISKY",
                    explanation="Significant rainfall is forecasted in the next 48 hours. Rain will wash surface-applied fertilizer away.",
                )
            )
        else:
            contributions.append(
                RuleContribution(
                    parameter="2-Day Rain Forecast",
                    observed_value=f"{expected_rain_next_48h_mm} mm expected",
                    impact="FAVORABLE",
                    explanation="No heavy rain is forecasted in the immediate 48-hour window.",
                )
            )

        # Evaluate soil wetness & texture
        is_sandy = sand_percent >= t["sandy_soil_sand_pct"]
        if is_sandy:
            contributions.append(
                RuleContribution(
                    parameter="Soil Texture (Sand %)",
                    observed_value=f"{sand_percent}% Sand (Sandy)",
                    impact="RISKY",
                    explanation="Sandy soils have high percolation rates, leading to rapid leaching of nitrogen fertilizers (like Urea).",
                )
            )
        else:
            contributions.append(
                RuleContribution(
                    parameter="Soil Texture",
                    observed_value=f"{sand_percent}% Sand (Loamy/Clayey)",
                    impact="FAVORABLE",
                    explanation="Balanced loam or clay soil retains nutrients well without excessive leaching.",
                )
            )

        # Evaluate slope
        is_steep = slope_percent >= t["slope_steep_pct"]
        if is_steep:
            contributions.append(
                RuleContribution(
                    parameter="Terrain Slope",
                    observed_value=f"{slope_percent}% (Sloping)",
                    impact="RISKY",
                    explanation="Sloping terrain significantly increases surface runoff risk during rainfall events.",
                )
            )
        else:
            contributions.append(
                RuleContribution(
                    parameter="Terrain Slope",
                    observed_value=f"{slope_percent}% (Flat/Gentle)",
                    impact="FAVORABLE",
                    explanation="Flat or gentle terrain minimizes surface runoff losses.",
                )
            )

        # Decision Matrix Logic
        # 1. WAIT if heavy rain expected soon or soil is flooded
        if expected_rain_next_48h_mm >= t["forecast_rain_heavy_mm"] or rain_last_72h_mm > 25.0:
            signal: DecisionSignal = "WAIT"
            wait_days = 3 if expected_rain_next_48h_mm > 20.0 else 2
            confidence = "HIGH" if expected_rain_next_48h_mm > 15.0 else "MODERATE"
            primary = f"Wait {wait_days} days before applying fertilizer due to incoming heavy rain."
            detailed = (
                f"Open-Meteo forecasts {expected_rain_next_48h_mm} mm of rain in the next 48 hours. "
                "Applying fertilizer now risks washing nutrients away before crop roots can absorb them."
            )

        # 2. APPLY IN SMALLER SPLITS if sandy soil, sloping terrain, or highly volatile fertilizer (Urea)
        elif (is_sandy or is_steep) and fertilizer_type == "Urea":
            signal = "APPLYIN SMALLER SPLITS" if False else "APPLY IN SMALLER SPLITS"
            wait_days = 0
            confidence = "HIGH"
            primary = "Apply in smaller split doses to prevent leaching and runoff losses."
            detailed = (
                f"Your field has { 'sandy soil' if is_sandy else 'sloping terrain' } "
                f"and you selected {fertilizer_type}. Applying all fertilizer at once risks heavy loss; "
                "splitting the application across 2–3 smaller doses protects your investment."
            )

        # 3. APPLY NOW if conditions are favorable
        else:
            signal = "APPLY NOW"
            wait_days = 0
            confidence = "HIGH" if soil_wetness >= 0.35 else "MODERATE"
            primary = "Conditions are favorable for fertilizer application today."
            detailed = (
                "Recent rainfall is low, no heavy storms are forecasted for the next 48 hours, "
                "and soil moisture is within an optimal range for nutrient uptake."
            )

        return DecisionResult(
            signal=signal,
            confidence=confidence,
            wait_days_recommended=wait_days,
            primary_reason=primary,
            detailed_explanation=detailed,
            rule_contributions=contributions,
        )