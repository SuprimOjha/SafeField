// Deterministic fertilizer-timing decision engine (port of
// fertilizer_engine.py + decision/rules.json v1.1.0). All thresholds are
// prototype design assumptions pending review by Nepalese agronomists; the
// save-money preference is intentionally non-operative.

import type { ConfidenceLevel, DecisionResult, DecisionSignal, RainfallObservation, RuleContribution } from "@/types/safefield";

const THRESHOLDS = {
  recent_rain_heavy_mm: 15.0,
  forecast_rain_heavy_mm: 10.0,
  slope_steep_pct: 8.0,
  sandy_soil_sand_pct: 55.0,
} as const;

export const DECISION_DISCLAIMER =
  "Research prototype only. Thresholds are design assumptions pending review by " +
  "Nepalese agronomists. Check the fertilizer product label, soil test and local " +
  "agricultural extension advice. This is not a safety certification or application rate.";

interface TimingInputs {
  rain_last_72h_mm: number | null;
  expected_rain_next_48h_mm: number | null;
  soil_wetness: number | null;
  sand_percent: number | null;
  slope_percent: number | null;
  fertilizer_type: string;
  crop_stage: string;
  priority_save_money: boolean;
  rainfall_observation: RainfallObservation | null;
}

export function evaluateTiming(inputs: TimingInputs): DecisionResult {
  let rain72 = inputs.rain_last_72h_mm;
  if (inputs.rainfall_observation) {
    rain72 = inputs.rainfall_observation.status === "AVAILABLE" ? inputs.rainfall_observation.amount_mm : null;
  }
  const { expected_rain_next_48h_mm: forecast48, soil_wetness, sand_percent, slope_percent, priority_save_money } = inputs;

  const contributions: RuleContribution[] = [];
  const ruleInputs: Record<string, number | null> = {
    "Recent rainfall (nominal 72h)": rain72,
    "Open-Meteo forecast (48h)": forecast48,
    "NASA POWER modeled surface wetness": soil_wetness,
    "SoilGrids predicted sand fraction": sand_percent,
    "Elevation-derived slope": slope_percent,
  };
  const missing = Object.entries(ruleInputs).filter(([, value]) => value === null).map(([name]) => name);

  const observation = inputs.rainfall_observation;
  if (observation) {
    let rainfallDetail: string;
    if (!observation.provenance) {
      rainfallDetail = "Rainfall source unavailable; no provenance supplied.";
    } else {
      const source = observation.provenance;
      rainfallDetail =
        `${source.source_name}; dataset=${source.dataset} version=${source.version} stream=${source.stream ?? "n/a"}; ` +
        `kind=${source.kind}; spatial_method=${source.spatial_method}; coverage_fraction=${source.coverage_fraction}; ` +
        `observed ${source.observed_start_utc} to ${source.observed_end_utc}; fetched ${source.fetched_at_utc}.`;
    }
    contributions.push({
      parameter: "Rainfall provenance",
      observed_value:
        observation.amount_mm === null
          ? "Unavailable"
          : `${observation.amount_mm} mm over ${observation.window_hours} hours`,
      impact: "NEUTRAL",
      explanation: rainfallDetail,
      evidence_status: "SOURCE PROVENANCE — NUMERIC SCREENING THRESHOLD PENDING EXPERT REVIEW",
    });
  }

  for (const [name, value] of Object.entries(ruleInputs)) {
    contributions.push({
      parameter: name,
      observed_value: value === null ? "Unavailable" : String(value),
      impact: value === null ? "NEUTRAL" : "FAVORABLE",
      explanation:
        value === null
          ? "No value was supplied; this input is not treated as zero or as favorable."
          : "Observed/modelled input is available; its threshold remains an unvalidated prototype assumption.",
    });
  }

  if (missing.length) {
    return {
      signal: "LOCAL REVIEW NEEDED",
      confidence: "CAUTION",
      wait_days_recommended: 0,
      primary_reason: "There is not enough reliable data to assess application timing.",
      detailed_explanation:
        "Unavailable inputs: " +
        missing.join(", ") +
        ". Do not interpret missing values as zero rainfall, dry soil or safe conditions. Check local conditions and consult an agricultural technician.",
      rule_contributions: contributions,
      disclaimer: DECISION_DISCLAIMER,
    };
  }

  const recentHeavy = (rain72 as number) >= THRESHOLDS.recent_rain_heavy_mm;
  const heavyForecast = (forecast48 as number) >= THRESHOLDS.forecast_rain_heavy_mm;

  let signal: DecisionSignal;
  let waitDays: number;
  let primary: string;
  let detail: string;

  if (heavyForecast || recentHeavy) {
    contributions.push({
      parameter: "Rain-related caution",
      observed_value: `recent=${rain72} mm; forecast=${forecast48} mm`,
      impact: "RISKY",
      explanation: "Prototype threshold indicates a reason to pause and recheck local weather and field conditions.",
    });
    signal = "WAIT AND RECHECK";
    waitDays = heavyForecast ? 2 : 1;
    primary = "Rain-related conditions suggest waiting and checking again.";
    detail =
      "This is a conservative screening flag, not a validated fertilizer schedule. Reassess after the rain event and follow the product label and local extension advice.";
  } else if (
    (slope_percent as number) >= THRESHOLDS.slope_steep_pct ||
    (sand_percent as number) >= THRESHOLDS.sandy_soil_sand_pct
  ) {
    contributions.push({
      parameter: "Field loss-risk screening",
      observed_value: `sand=${sand_percent}%; slope=${slope_percent}%`,
      impact: "RISKY",
      explanation:
        "Texture and slope may affect nutrient movement; the numeric cut-offs are design assumptions pending expert review.",
    });
    signal = "LOCAL REVIEW NEEDED";
    waitDays = 0;
    primary = "Local soil and field review is recommended before deciding.";
    detail =
      "Do not infer a smaller fertilizer dose from this screen. Confirm crop nutrient needs, soil test results and recommended application rates with a local technician.";
  } else {
    signal = "CONDITIONS LOOK SUITABLE";
    waitDays = 0;
    primary = "The available indicators do not trigger the prototype's rain or terrain cautions.";
    detail =
      "This does not establish that fertilizer is needed or that application is safe. Check the product label, crop-specific recommendation, soil test and local conditions.";
  }

  contributions.push({
    parameter: "Save-money preference",
    observed_value: priority_save_money ? "Selected" : "Not selected",
    impact: "NEUTRAL",
    explanation: "This preference does not change timing, nutrient rate, warnings or the decision signal.",
    evidence_status: "USER PREFERENCE ONLY — NO DECISION EFFECT",
  });

  const confidence: ConfidenceLevel = "CAUTION";
  return {
    signal,
    confidence,
    wait_days_recommended: waitDays,
    primary_reason: primary,
    detailed_explanation: detail,
    rule_contributions: contributions,
    disclaimer: DECISION_DISCLAIMER,
  };
}
