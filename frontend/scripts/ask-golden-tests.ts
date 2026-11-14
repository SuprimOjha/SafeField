// Ask assistant — golden tests (Work Package 1).
//
// Covers: for each intent and language, tool results -> expected template
// output; refusal paths (fixed refusal verbatim, medical referral); structural
// hard rules (no banned words, no markdown/emoji, source+kind+date on numbers,
// review banner flag, label reminder where required).
//
// Run with bun (bundler-style extensionless TS imports):
//   bun scripts/ask-golden-tests.ts

import assert from "node:assert/strict";
import { ASK_INTENT_IDS } from "../src/lib/ask/intents";
import { buildAskResponse, buildMedicalSafetyResponse } from "../src/lib/ask/answer";
import { getContent, getRotationPlans } from "../src/lib/ask/tools";
import { FIXED_REFUSAL, MEDICAL_REFERRAL } from "../src/lib/ask/refusals";
import type {
  AskFieldContext,
  AskIntent,
  AskLang,
  AskResponse,
} from "../src/lib/ask/types";
import type {
  DecisionResult,
  FieldAssessmentResponse,
  FarmerContentResponse,
  FreshnessBadgeData,
  RainfallProvenance,
} from "../src/types/safefield";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RAIN_PROVENANCE: RainfallProvenance = {
  source_name: "NASA GPM IMERG Late",
  kind: "observation",
  observed_start_utc: "2026-01-27T00:00:00Z",
  observed_end_utc: "2026-01-29T21:30:00Z",
  fetched_at_utc: "2026-01-30T05:00:00Z",
  spatial_resolution: "0.1 deg (~10 km)",
  latency_note: "Late run, near-real-time",
  dataset: "GPM_3IMERGDL",
  version: "07",
  stream: "Late",
  granule_ids: ["GPM_3IMERGDL_TEST"],
  units: "mm/day",
  spatial_method: "nearest_grid_cell",
  coverage_fraction: 0.95,
};

function badge(overrides: Partial<FreshnessBadgeData>): FreshnessBadgeData {
  return {
    dataset_name: "Test dataset",
    source_org: "Test org",
    is_nasa: true,
    status: "LIVE",
    latest_observation_date: "2026-01-28",
    fetched_at_utc: "2026-01-30T06:00:00Z",
    typical_latency: "2-4 days",
    spatial_resolution: "~55 km",
    caveat: "fixture caveat",
    docs_url: "https://example.com/docs",
    ...overrides,
  };
}

function decisionFixture(kind: "wait" | "suitable" | "terrain" | "missing"): DecisionResult {
  switch (kind) {
    case "wait":
      return {
        signal: "WAIT AND RECHECK",
        confidence: "CAUTION",
        wait_days_recommended: 2,
        primary_reason: "Rain-related conditions suggest waiting and checking again.",
        detailed_explanation: "fixture detail",
        rule_contributions: [],
        disclaimer: "fixture disclaimer",
      };
    case "suitable":
      return {
        signal: "CONDITIONS LOOK SUITABLE",
        confidence: "CAUTION",
        wait_days_recommended: 0,
        primary_reason: "The available indicators do not trigger the prototype's rain or terrain cautions.",
        detailed_explanation: "fixture detail",
        rule_contributions: [],
        disclaimer: "fixture disclaimer",
      };
    case "terrain":
      return {
        signal: "LOCAL REVIEW NEEDED",
        confidence: "CAUTION",
        wait_days_recommended: 0,
        primary_reason: "Local soil and field review is recommended before deciding.",
        detailed_explanation: "fixture detail",
        rule_contributions: [],
        disclaimer: "fixture disclaimer",
      };
    case "missing":
      return {
        signal: "LOCAL REVIEW NEEDED",
        confidence: "CAUTION",
        wait_days_recommended: 0,
        primary_reason: "There is not enough reliable data to assess application timing.",
        detailed_explanation: "fixture detail",
        rule_contributions: [],
        disclaimer: "fixture disclaimer",
      };
  }
}

interface AssessmentOptions {
  decision: "wait" | "suitable" | "terrain" | "missing";
  rain72?: number | null;
  forecast48?: number | null;
  wetness?: number | null;
  sand?: number | null;
  slope?: number | null;
  withImerg?: boolean;
  fetchedAt?: string;
  forecastDays?: number;
}

function makeAssessment(options: AssessmentOptions): FieldAssessmentResponse {
  const {
    decision,
    rain72 = 18.4,
    forecast48 = 22.1,
    wetness = 0.42,
    sand = 62.3,
    slope = 3.2,
    withImerg = true,
    fetchedAt = "2026-01-30T06:00:00Z",
    forecastDays = 5,
  } = options;

  const powerFreshness = badge({
    dataset_name: "Daily meteorological reanalysis",
    source_org: "NASA POWER",
    is_nasa: true,
    latest_observation_date: "2026-01-28",
    fetched_at_utc: fetchedAt,
  });
  const days = Array.from({ length: forecastDays }, (_, index) => ({
    date: `2026-0${index < 2 ? 1 : 2}-${String(30 + index - (index < 2 ? 0 : 31) + 1).padStart(2, "0")}`,
    precipitation_sum_mm: [22.1, 8, 1, 0, 0.2][index] ?? 0,
    precipitation_probability_max: [80, 55, 20, 5, 10][index] ?? 0,
  }));
  const dayDates = ["2026-01-30", "2026-01-31", "2026-02-01", "2026-02-02", "2026-02-03"];

  return {
    rainfall_observation: withImerg
      ? {
          status: "AVAILABLE",
          amount_mm: rain72,
          window_hours: 72,
          provenance: RAIN_PROVENANCE,
          unavailable_reason: null,
        }
      : {
          status: "UNAVAILABLE",
          amount_mm: null,
          window_hours: 72,
          provenance: null,
          unavailable_reason: "No fresh IMERG cache and no usable POWER daily triple.",
        },
    latitude: 26.45,
    longitude: 87.28,
    power_summary: {
      latitude: 26.45,
      longitude: 87.28,
      freshness: powerFreshness,
      rain_last_24h_mm: 6.1,
      rain_last_72h_mm: rain72,
      latest_surface_wetness: wetness,
      latest_root_wetness: wetness === null ? null : wetness - 0.04,
      latest_temp_c: 24.3,
      recent_daily_records: [],
      historical_daily_records: [],
    },
    elevation: {
      latitude: 26.45,
      longitude: 87.28,
      elevation_meters: 120,
      slope_percent: slope,
      terrain_category: "Flat",
      freshness: badge({
        dataset_name: "Copernicus DEM GLO-90",
        source_org: "Open-Meteo Elevation",
        is_nasa: false,
      }),
    },
    soil_texture: {
      latitude: 26.45,
      longitude: 87.28,
      clay_percent: sand === null ? null : 19.5,
      silt_percent: sand === null ? null : 18.2,
      sand_percent: sand,
      texture_class: sand === null ? "" : "Sandy Loam",
      freshness: badge({
        dataset_name: "SoilGrids 250 m prediction",
        source_org: "ISRIC",
        is_nasa: false,
      }),
    },
    forecast: {
      latitude: 26.45,
      longitude: 87.28,
      freshness: badge({
        dataset_name: "Rain forecast (ECMWF IFS)",
        source_org: "Open-Meteo",
        is_nasa: false,
        fetched_at_utc: fetchedAt,
      }),
      forecast_days: days.map((day, index) => ({ ...day, date: dayDates[index] ?? day.date })),
      expected_rain_next_48h_mm: forecast48,
      expected_rain_next_120h_mm: forecast48 === null ? null : forecast48 + 9.2,
      rain_expected_soon: forecast48 === null ? null : forecast48 >= 10,
    },
    decision: decisionFixture(decision),
    climate_trend: {
      variable_name: "heavy_rain_days",
      years_analyzed: 40,
      total_observations: 14600,
      raw_slope_per_decade: 0.5,
      theil_sen_slope_per_decade: 0.4,
      confidence_interval_lower: -0.2,
      confidence_interval_upper: 1.0,
      mann_kendall_p_value: 0.2,
      corrected_p_value: 0.6,
      significant_before_fdr: false,
      significant_after_fdr: false,
      plain_language_summary: "fixture",
    },
  };
}

function context(overrides: Partial<AskFieldContext> = {}): AskFieldContext {
  return {
    latitude: 26.45,
    longitude: 87.28,
    answers: {
      fertilizerType: "Urea",
      cropStage: "Vegetative / Tillering",
      saveMoney: true,
      sandPercentOverride: null,
    },
    assessment: makeAssessment({ decision: "wait" }),
    previousAssessment: null,
    farmerContent: null,
    ...overrides,
  };
}

const WAIT_ASSESSMENT = makeAssessment({ decision: "wait" });
const SUITABLE_ASSESSMENT = makeAssessment({
  decision: "suitable",
  rain72: 2.0,
  forecast48: 0.0,
  wetness: 0.31,
  sand: 40.1,
  slope: 3.2,
  fetchedAt: "2026-01-24T06:00:00Z",
});
const TERRAIN_ASSESSMENT = makeAssessment({
  decision: "terrain",
  rain72: 2.0,
  forecast48: 0.0,
});
const MISSING_ASSESSMENT = makeAssessment({
  decision: "missing",
  rain72: null,
  forecast48: null,
  wetness: null,
  sand: null,
  slope: null,
  withImerg: false,
});
const EMPTY_FORECAST_ASSESSMENT = makeAssessment({ decision: "suitable", forecastDays: 0, forecast48: null });

const CONTENT_FIXTURE: FarmerContentResponse = {
  status: "ok",
  sources: {},
  fertilizer_references: [
    {
      id: "r1", crop: "Rice", varietyType: "", region: "", nutrientOrProduct: "Nitrogen", basis: "nutrient",
      valueMin: 60, valueMax: 80, unitAsPrinted: "kg/ha", timingSplit: "split doses", sourceKey: "s1",
      secondSourceKey: null, year: 2024, page: "12", shortQuote: "q", confidence: "single-source",
      verified: false, reviewStatus: "not-expert-reviewed", reviewer: null,
    },
    {
      id: "r2", crop: "Rice", varietyType: "", region: "", nutrientOrProduct: "Potash", basis: "nutrient",
      valueMin: 20, valueMax: 40, unitAsPrinted: "kg/ha", timingSplit: "basal", sourceKey: "s1",
      secondSourceKey: null, year: 2024, page: "13", shortQuote: "q", confidence: "single-source",
      verified: false, reviewStatus: "not-expert-reviewed", reviewer: null,
    },
  ],
  home_remedies: [
    {
      id: "h1", crop: "Rice", problem: "blast", remedyText: "field sanitation", quantitiesAsPrinted: null,
      preparationNotesAsPrinted: null, sourceKey: "s1", evidence: "extension", verified: false,
      safetyNotes: "n/a", reviewStatus: "not-expert-reviewed", reviewer: null,
    },
  ],
  conversions: [],
  skipped: {},
  warnings: [],
};

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let passed = 0;
const failures: string[] = [];

function test(name: string, body: () => void): void {
  try {
    body();
    passed += 1;
  } catch (error) {
    failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// ---------------------------------------------------------------------------
// Structural hard-rule checks
// ---------------------------------------------------------------------------

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
const MARKDOWN = /[*#_~`]/;

function assertReadAloudSafe(text: string): void {
  assert.ok(!EMOJI.test(text), "text must not contain emojis");
  assert.ok(!MARKDOWN.test(text), `text must not contain markdown symbols: ${text.slice(0, 120)}`);
}

function assertNoBannedClaims(text: string): void {
  assert.ok(!/safe/i.test(text), "text must not contain the word safe");
  assert.ok(!/guarantee/i.test(text), "text must not contain guaranteed");
  assert.ok(!/\bbest\b/i.test(text), "text must not contain best");
  assert.ok(!text.includes("सुरक्षित"), "text must not claim सुरक्षित");
  assert.ok(!text.includes("सुनिश्चित"), "text must not claim सुनिश्चित");
}

function assertGrounded(response: AskResponse): void {
  assert.ok(response.text.length > 0, "answer text must not be empty");
  assert.ok(response.text.length <= 1600, "answer text must stay readable (max 1600 chars)");
  assert.equal(response.aiAssisted, false, "L0 answers are never AI-assisted");
  assertReadAloudSafe(response.text);
  if (response.scope === "answer") {
    assert.equal(response.requiresReviewBanner, true, "review banner required while no expert review record exists");
    if (response.facts.length > 0) {
      assert.ok(/\d{4}-\d{2}-\d{2}/.test(response.text), "answers that state numbers must show a date");
    }
  }
}

// ---------------------------------------------------------------------------
// Intent list
// ---------------------------------------------------------------------------

test("intent list is the closed 12-item contract", () => {
  assert.deepEqual([...ASK_INTENT_IDS], [
    "can_apply_today", "check_soil", "rain_this_week", "stay_safe",
    "explain_card", "explain_term", "data_source", "explain_rotation",
    "what_changed", "irrigation_timing_hint", "fertilizer_timing_window", "unknown",
  ]);
});

// ---------------------------------------------------------------------------
// can_apply_today
// ---------------------------------------------------------------------------

test("can_apply_today en keeps decision word verbatim with provenance and label reminder", () => {
  const r = buildAskResponse("can_apply_today", context(), "en");
  assert.equal(r.scope, "answer");
  assert.equal(r.level, "WAIT AND RECHECK");
  assert.ok(r.text.includes("Decision level: WAIT AND RECHECK."), r.text);
  assert.ok(r.text.includes("waiting about 2 days"), r.text);
  assert.ok(r.text.includes("Rain-related conditions suggest waiting and checking again."), r.text);
  assert.ok(r.text.includes("18.4 mm"), r.text);
  assert.ok(r.text.includes("NASA GPM IMERG Late"), r.text);
  assert.ok(r.text.includes("NASA source"), r.text);
  assert.ok(r.text.includes("Kind: observation"), r.text);
  assert.ok(r.text.includes("Observation date: 2026-01-29"), r.text);
  assert.ok(r.text.includes("non-NASA source"), r.text);
  assert.ok(r.text.includes("Open-Meteo"), r.text);
  assert.ok(r.text.includes("Fetched date: 2026-01-30"), r.text);
  assert.ok(r.text.includes("Always follow the product label."), r.text);
  assert.equal(r.requiresLabelReminder, true);
  assertNoBannedClaims(r.text);
  assertReadAloudSafe(r.text);
});

test("can_apply_today ne keeps decision word verbatim plus app nepali label", () => {
  const r = buildAskResponse("can_apply_today", context(), "ne");
  assert.equal(r.scope, "answer");
  assert.equal(r.level, "WAIT AND RECHECK");
  assert.ok(r.text.includes("निर्णय स्तर: WAIT AND RECHECK (पर्खनुहोस् र पुनः जाँच्नुहोस्)"), r.text);
  assert.ok(r.text.includes("2 दिन"), r.text);
  assert.ok(r.text.includes("गैर-NASA स्रोत"), r.text);
  assert.ok(r.text.includes("प्रकार: अवलोकन"), r.text);
  assert.ok(r.text.includes("अवलोकन मिति: 2026-01-29"), r.text);
  assert.ok(r.text.includes("सधैं उत्पादनको लेबल पालना गर्नुहोस्।"), r.text);
  assertNoBannedClaims(r.text);
  assertReadAloudSafe(r.text);
});

test("can_apply_today suitable keeps exact favorable level", () => {
  const r = buildAskResponse("can_apply_today", context({ assessment: SUITABLE_ASSESSMENT }), "en");
  assert.equal(r.level, "CONDITIONS LOOK SUITABLE");
  assert.ok(r.text.includes("Decision level: CONDITIONS LOOK SUITABLE."), r.text);
});

test("can_apply_today terrain keeps exact review level", () => {
  const r = buildAskResponse("can_apply_today", context({ assessment: TERRAIN_ASSESSMENT }), "en");
  assert.equal(r.level, "LOCAL REVIEW NEEDED");
  assert.ok(r.text.includes("Decision level: LOCAL REVIEW NEEDED."), r.text);
});

test("can_apply_today names missing inputs and never treats them as zero", () => {
  const r = buildAskResponse("can_apply_today", context({ assessment: MISSING_ASSESSMENT }), "en");
  assert.equal(r.level, "LOCAL REVIEW NEEDED");
  assert.ok(r.text.includes("Missing values were not treated as zero."), r.text);
  assert.ok(r.text.includes("Missing: "), r.text);
  assert.ok(r.text.includes("the predicted sand fraction"), r.text);
  assert.ok(r.missing.length >= 4, "missing inputs are named");
});

test("can_apply_today without assessment says so plainly and points to the office", () => {
  const r = buildAskResponse("can_apply_today", context({ assessment: null }), "en");
  assert.equal(r.scope, "unavailable");
  assert.ok(r.text.includes("No field assessment is loaded"), r.text);
  assert.ok(r.text.includes("agriculture office"), r.text);
});

// ---------------------------------------------------------------------------
// check_soil
// ---------------------------------------------------------------------------

test("check_soil en reports soilgrids values as non-nasa model with date", () => {
  const r = buildAskResponse("check_soil", context(), "en");
  assert.equal(r.scope, "answer");
  assert.ok(r.text.includes("62.3 percent"), r.text);
  assert.ok(r.text.includes("ISRIC SoilGrids 250 m prediction"), r.text);
  assert.ok(r.text.includes("non-NASA source"), r.text);
  assert.ok(r.text.includes("Kind: model estimate"), r.text);
  assert.ok(r.text.includes("not a soil test"), r.text);
  assertNoBannedClaims(r.text);
  assertReadAloudSafe(r.text);
});

test("check_soil ne reports the same facts in nepali", () => {
  const r = buildAskResponse("check_soil", context(), "ne");
  assert.ok(r.text.includes("62.3 प्रतिशत"), r.text);
  assert.ok(r.text.includes("SoilGrids"), r.text);
  assert.ok(r.text.includes("गैर-NASA स्रोत"), r.text);
  assert.ok(r.text.includes("माटो परीक्षण"), r.text);
  assertReadAloudSafe(r.text);
});

test("check_soil marks farmer override as farmer input", () => {
  const ctx = context();
  ctx.answers.sandPercentOverride = 58;
  const r = buildAskResponse("check_soil", ctx, "en");
  assert.ok(r.text.includes("58 percent"), r.text);
  assert.ok(r.text.includes("You entered this value"), r.text);
  assert.ok(r.text.includes("used the value you entered"), r.text);
  assert.ok(r.facts.some((fact) => fact.provenance?.kind === "farmer_input"));
});

// ---------------------------------------------------------------------------
// rain_this_week
// ---------------------------------------------------------------------------

test("rain_this_week en lists days, totals and non-nasa forecast provenance", () => {
  const r = buildAskResponse("rain_this_week", context(), "en");
  assert.equal(r.scope, "answer");
  assert.ok(r.text.includes("Rain on 2026-01-30: 22.1 mm; rain chance 80 percent."), r.text);
  assert.ok(r.text.includes("Rain on 2026-01-31: 8 mm; rain chance 55 percent."), r.text);
  assert.ok(r.text.includes("Rain forecast (next 48 hours): 22.1 mm."), r.text);
  assert.ok(r.text.includes("Open-Meteo"), r.text);
  assert.ok(r.text.includes("non-NASA source"), r.text);
  assert.ok(r.text.includes("Kind: forecast"), r.text);
  assert.ok(r.text.includes("Fetched date: 2026-01-30"), r.text);
  assert.ok(r.text.includes("model estimate, not measured rain"), r.text);
  assertNoBannedClaims(r.text);
  assertReadAloudSafe(r.text);
});

test("rain_this_week ne mirrors the english answer", () => {
  const r = buildAskResponse("rain_this_week", context(), "ne");
  assert.ok(r.text.includes("मि.मी."), r.text);
  assert.ok(r.text.includes("वर्षा सम्भावना 80 प्रतिशत"), r.text);
  assert.ok(r.text.includes("गैर-NASA स्रोत"), r.text);
  assertReadAloudSafe(r.text);
});

test("rain_this_week unavailable never implies zero rain", () => {
  const r = buildAskResponse("rain_this_week", context({ assessment: EMPTY_FORECAST_ASSESSMENT }), "en");
  assert.equal(r.scope, "unavailable");
  assert.ok(r.text.includes("does not mean zero rainfall"), r.text);
});

// ---------------------------------------------------------------------------
// stay_safe
// ---------------------------------------------------------------------------

test("stay_safe en gives precautions with label reminder and no outcome claims", () => {
  const r = buildAskResponse("stay_safe", context(), "en");
  assert.equal(r.scope, "answer");
  assert.equal(r.requiresLabelReminder, true);
  assert.ok(r.text.includes("dust mask"), r.text);
  assert.ok(r.text.includes("Always follow the product label."), r.text);
  assert.ok(r.text.includes("contact a health worker"), r.text);
  assertNoBannedClaims(r.text);
  assertReadAloudSafe(r.text);
});

test("stay_safe ne mirrors the english answer", () => {
  const r = buildAskResponse("stay_safe", context(), "ne");
  assert.ok(r.text.includes("मास्क"), r.text);
  assert.ok(r.text.includes("लेबल पालना गर्नुहोस्"), r.text);
  assertReadAloudSafe(r.text);
});

// ---------------------------------------------------------------------------
// explain_card
// ---------------------------------------------------------------------------

test("explain_card decision shows the level verbatim", () => {
  const r = buildAskResponse("explain_card", context(), "en", { cardId: "decision" });
  assert.equal(r.level, "WAIT AND RECHECK");
  assert.ok(r.text.includes("Decision level: WAIT AND RECHECK."), r.text);
  assert.equal(r.requiresLabelReminder, true);
});

test("explain_card rainfall explains the used value and the zero rule", () => {
  const r = buildAskResponse("explain_card", context(), "en", { cardId: "rainfall" });
  assert.ok(r.text.includes("18.4 mm"), r.text);
  assert.ok(r.text.includes("did not treat it as zero"), r.text);
});

test("explain_card soil renders in nepali with provenance", () => {
  const r = buildAskResponse("explain_card", context(), "ne", { cardId: "soil" });
  assert.ok(r.text.includes("प्रतिशत"), r.text);
  assert.ok(r.text.includes("SoilGrids"), r.text);
});

test("explain_card without a card asks one short question with three buttons", () => {
  const r = buildAskResponse("explain_card", context(), "en");
  assert.equal(r.scope, "clarification");
  assert.ok(r.clarification);
  assert.equal(r.clarification.options.length, 3);
  assert.ok(r.clarification.options.every((option) => option.intent === "explain_card"));
  assert.ok(r.clarification.question.ne.length > 0);
});

test("explain_card with an unknown card id is an honest unavailable", () => {
  const r = buildAskResponse("explain_card", context(), "en", { cardId: "banana" });
  assert.equal(r.scope, "unavailable");
  assert.ok(r.text.includes("decision, rainfall"), r.text);
});

// ---------------------------------------------------------------------------
// explain_term
// ---------------------------------------------------------------------------

test("explain_term soilgrids en and ne", () => {
  const en = buildAskResponse("explain_term", context(), "en", { term: "SoilGrids" });
  assert.equal(en.scope, "answer");
  assert.ok(en.text.includes("SoilGrids means:"), en.text);
  assert.ok(en.text.includes("ISRIC"), en.text);
  const ne = buildAskResponse("explain_term", context(), "ne", { term: "SoilGrids" });
  assert.ok(ne.text.includes("भनेको"), ne.text);
});

test("explain_term unknown term lists what it can explain", () => {
  const r = buildAskResponse("explain_term", context(), "en", { term: "quantum" });
  assert.equal(r.scope, "unavailable");
  assert.ok(r.text.includes("Terms I can explain"), r.text);
});

test("explain_term without a term asks one short question", () => {
  const r = buildAskResponse("explain_term", context(), "en");
  assert.equal(r.scope, "clarification");
  assert.equal(r.clarification?.options.length, 3);
});

// ---------------------------------------------------------------------------
// data_source
// ---------------------------------------------------------------------------

test("data_source all lists nasa and non-nasa datasets with status and dates", () => {
  const r = buildAskResponse("data_source", context(), "en", { valueId: "all" });
  assert.equal(r.scope, "answer");
  assert.ok(r.text.includes("NASA POWER"), r.text);
  assert.ok(r.text.includes("NASA source"), r.text);
  assert.ok(r.text.includes("Open-Meteo"), r.text);
  assert.ok(r.text.includes("non-NASA source"), r.text);
  assert.ok(r.text.includes("Status: LIVE"), r.text);
  assert.ok(r.text.includes("GPM_3IMERGDL"), r.text);
  assert.ok(/\d{4}-\d{2}-\d{2}/.test(r.text), r.text);
});

test("data_source forecast names the kind and non-nasa label", () => {
  const r = buildAskResponse("data_source", context(), "en", { valueId: "forecast" });
  assert.ok(r.text.includes("Open-Meteo"), r.text);
  assert.ok(r.text.includes("Kind: forecast"), r.text);
  assert.ok(r.text.includes("non-NASA source"), r.text);
});

test("data_source without a value asks one short question", () => {
  const r = buildAskResponse("data_source", context(), "en");
  assert.equal(r.scope, "clarification");
  assert.equal(r.clarification?.options.length, 3);
});

test("data_source with an unknown value id is honest", () => {
  const r = buildAskResponse("data_source", context(), "en", { valueId: "moon_rocks" });
  assert.equal(r.scope, "unavailable");
  assert.ok(r.text.includes("Known items:"), r.text);
});

// ---------------------------------------------------------------------------
// explain_rotation / what_changed / P1 intents
// ---------------------------------------------------------------------------

test("explain_rotation says it is not connected and names what is missing", () => {
  const r = buildAskResponse("explain_rotation", context(), "en");
  assert.equal(r.scope, "unavailable");
  assert.ok(r.text.includes("Crop rotation planning is not connected"), r.text);
  assert.ok(r.text.includes("an expert-reviewed crop rotation module"), r.text);
  assert.ok(r.text.includes("agriculture office"), r.text);
});

test("explain_rotation ne mirrors the english refusal to answer", () => {
  const r = buildAskResponse("explain_rotation", context(), "ne");
  assert.ok(r.text.includes("जोडिएको छैन"), r.text);
  assert.ok(r.text.includes("कृषि कार्यालय"), r.text);
});

test("what_changed reports level and value changes with provenance", () => {
  const r = buildAskResponse(
    "what_changed",
    context({ assessment: WAIT_ASSESSMENT, previousAssessment: SUITABLE_ASSESSMENT }),
    "en",
  );
  assert.equal(r.scope, "answer");
  assert.ok(r.text.includes("Decision level changed from CONDITIONS LOOK SUITABLE to WAIT AND RECHECK."), r.text);
  assert.ok(r.text.includes("Recent rainfall changed from 2 mm to 18.4 mm."), r.text);
  assert.ok(r.text.includes("The 48-hour rain forecast changed from 0 mm to 22.1 mm."), r.text);
  assert.ok(r.text.includes("saved on 2026-01-24"), r.text);
  assert.ok(r.text.includes("Source:"), r.text);
});

test("what_changed ne mirrors the comparison", () => {
  const r = buildAskResponse(
    "what_changed",
    context({ assessment: WAIT_ASSESSMENT, previousAssessment: SUITABLE_ASSESSMENT }),
    "ne",
  );
  assert.ok(r.text.includes("बदलियो"), r.text);
});

test("what_changed without a previous assessment says so plainly", () => {
  const r = buildAskResponse("what_changed", context(), "en");
  assert.equal(r.scope, "unavailable");
  assert.ok(r.text.includes("previous saved assessment"), r.text);
});

test("irrigation_timing_hint is an honest unavailable in both languages", () => {
  const en = buildAskResponse("irrigation_timing_hint", context(), "en");
  assert.equal(en.scope, "unavailable");
  assert.ok(en.text.includes("irrigation timing hint"), en.text);
  assert.ok(en.text.includes("agriculture office"), en.text);
  const ne = buildAskResponse("irrigation_timing_hint", context(), "ne");
  assert.ok(ne.text.includes("सिँचाइ"), ne.text);
  assert.ok(ne.text.includes("कृषि कार्यालय"), ne.text);
});

test("fertilizer_timing_window is an honest unavailable with label reminder", () => {
  const en = buildAskResponse("fertilizer_timing_window", context(), "en");
  assert.equal(en.scope, "unavailable");
  assert.equal(en.requiresLabelReminder, true);
  assert.ok(en.text.includes("fertilizer timing window"), en.text);
  assert.ok(en.text.includes("Always follow the product label."), en.text);
  const ne = buildAskResponse("fertilizer_timing_window", context(), "ne");
  assert.ok(ne.text.includes("लेबल पालना गर्नुहोस्"), ne.text);
});

// ---------------------------------------------------------------------------
// Refusal and medical paths
// ---------------------------------------------------------------------------

test("unknown maps to the exact fixed refusal in both languages", () => {
  const en = buildAskResponse("unknown", context(), "en");
  assert.equal(en.scope, "refusal");
  assert.equal(en.text, FIXED_REFUSAL.en);
  assert.equal(en.text, "Sorry, I cannot answer this. Please ask your local agriculture office.");
  const ne = buildAskResponse("unknown", context(), "ne");
  assert.equal(ne.text, FIXED_REFUSAL.ne);
  assert.equal(
    ne.text,
    "माफ गर्नुहोस्, म यो प्रश्नको उत्तर दिन सक्दिनँ। कृपया आफ्नो नजिकको कृषि कार्यालयसँग सोध्नुहोस्।",
  );
});

test("medical referral never advises treatment and is marked for expert review", () => {
  const en = buildMedicalSafetyResponse("en");
  assert.equal(en.scope, "medical");
  assert.equal(en.markedForExpertReview, true);
  assert.ok(en.text.includes("Stop work"), en.text);
  assert.ok(en.text.includes("fresh air"), en.text);
  assert.ok(en.text.includes("health worker"), en.text);
  assert.ok(en.text.includes("hospital"), en.text);
  assert.ok(en.text.includes("cannot give treatment advice"), en.text);
  assert.equal(en.text, MEDICAL_REFERRAL.en);
  const ne = buildMedicalSafetyResponse("ne");
  assert.ok(ne.text.includes("काम रोक्नुहोस्"), ne.text);
  assert.ok(ne.text.includes("अस्पताल"), ne.text);
  assertReadAloudSafe(ne.text);
});

// ---------------------------------------------------------------------------
// Tool interfaces (direct)
// ---------------------------------------------------------------------------

test("get_content exposes only counts and review status, never quantities", () => {
  const result = getContent(context({ farmerContent: CONTENT_FIXTURE }), "Rice");
  assert.ok(result.available);
  assert.equal(result.data?.fertilizerRefCount, 2);
  assert.equal(result.data?.homeRemedyCount, 1);
  assert.equal(result.data?.allExpertReviewed, false);
  const serialized = JSON.stringify(result.data);
  assert.ok(!serialized.includes("valueMin"), "quantities must never leave the tool");
  assert.ok(!serialized.includes("kg/ha"), "quantities must never leave the tool");
});

test("get_content without the content service is unavailable", () => {
  const result = getContent(context(), "Rice");
  assert.equal(result.available, false);
  assert.ok(result.unavailableReason?.en.includes("not connected"));
});

test("get_rotation_plans is always unavailable with a named gap", () => {
  const result = getRotationPlans(context());
  assert.equal(result.available, false);
  assert.ok(result.missing[0]?.en.includes("rotation module"));
});

// ---------------------------------------------------------------------------
// Whole-contract sweeps
// ---------------------------------------------------------------------------

const ALL_INTENTS: AskIntent[] = [...ASK_INTENT_IDS];
const LANGS: AskLang[] = ["en", "ne"];

test("every intent answers in both languages with the same scope and grounded text", () => {
  for (const intent of ALL_INTENTS) {
    for (const lang of LANGS) {
      const r = buildAskResponse(intent, context(), lang);
      const other = buildAskResponse(intent, context(), lang === "en" ? "ne" : "en");
      assert.equal(r.scope, other.scope, `scope parity for ${intent}`);
      assertGrounded(r);
      assert.equal(r.intent, intent);
      assert.equal(r.language, lang);
    }
  }
});

test("no answer names the selected fertilizer product", () => {
  for (const intent of ALL_INTENTS) {
    for (const lang of LANGS) {
      const r = buildAskResponse(intent, context(), lang);
      assert.ok(!r.text.includes("Urea"), "product names must not appear");
      assert.ok(!r.text.includes("DAP"), "product names must not appear");
    }
  }
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`Ask golden tests: ${passed} passed, ${failures.length} failed`);
for (const failure of failures) {
  console.log(`  FAIL ${failure}`);
}
process.exit(failures.length > 0 ? 1 : 0);
