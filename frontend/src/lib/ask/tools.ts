// Ask assistant — deterministic tools (Work Package 1).
//
// These are the ONLY data sources the assistant may read (TRD operating rule).
// Each tool is a pure function over AskFieldContext: no model, no free text,
// no network calls, so L0 works fully offline of any model. Every tool returns
// data plus provenance (source, kind, validity/fetch dates, resolution, latency
// note) so templates can carry source, kind and date into every answer that
// states a number.
//
// get_rotation_plans, irrigation thresholds and crop-specific schedules are not
// connected in this prototype; the corresponding tools return available=false
// and NAME what is missing (hard rule 1).

import type {
  AskFact,
  AskFieldContext,
  AskProvenance,
  AskSlots,
  AskToolResult,
  Bi,
  ConditionsData,
  ContentData,
  DataSourceStatus,
  ForecastSummaryData,
  GlossaryEntry,
  SafeApplicationData,
} from "./types";
import type { DailyForecastItem, FieldAssessmentResponse, FreshnessBadgeData } from "../../types/safefield";
import {
  fmtNum,
  makeFact,
  provenanceFromFreshness,
  provenanceFromRainfall,
  farmerProvenance,
} from "./provenance";
import { findGlossaryEntry, GLOSSARY_TERMS } from "./glossary";

// ---------------------------------------------------------------------------
// Bilingual fact labels
// ---------------------------------------------------------------------------

const L = {
  rain72: {
    en: "Recent rainfall (past 72 hours)",
    ne: "पछिल्लो ७२ घण्टाको वर्षा",
  },
  forecast48: {
    en: "Rain forecast (next 48 hours)",
    ne: "आगामी ४८ घण्टाको वर्षा पूर्वानुमान",
  },
  forecast120: {
    en: "Rain forecast (next 120 hours)",
    ne: "आगामी १२० घण्टाको वर्षा पूर्वानुमान",
  },
  rainDay: { en: "Forecast rain", ne: "पूर्वानुमानित वर्षा" },
  rainChance: { en: "Rain chance", ne: "वर्षा सम्भावना" },
  surfaceWetness: { en: "Modelled surface wetness (index)", ne: "मोडेल गरिएको सतही चिस्यान (सूचक)" },
  rootWetness: { en: "Modelled root wetness (index)", ne: "मोडेल गरिएको जरा-चिस्यान (सूचक)" },
  temperature: { en: "Recent daily air temperature", ne: "पछिल्लो दैनिक हावाको तापक्रम" },
  sand: { en: "Predicted sand fraction", ne: "अनुमानित ढुस्सा (sand) प्रतिशत" },
  silt: { en: "Predicted silt fraction", ne: "अनुमानित सिल्ट (silt) प्रतिशत" },
  clay: { en: "Predicted clay fraction", ne: "अनुमानित क्ले (clay) प्रतिशत" },
  textureClass: { en: "Predicted texture class", ne: "अनुमानित बनावट वर्ग" },
  slope: { en: "Estimated slope", ne: "अनुमानित ढाल" },
  elevation: { en: "Estimated elevation", ne: "अनुमानित उचाई" },
} as const;

const MISSING = {
  rain72: { en: "a usable recent rainfall value", ne: "प्रयोगयोग्य पछिल्लो वर्षा मान" },
  forecast48: { en: "the rain forecast for the next 48 hours", ne: "आगामी ४८ घण्टाको वर्षा पूर्वानुमान" },
  surfaceWetness: { en: "the modelled surface wetness value", ne: "मोडेल गरिएको सतही चिस्यान मान" },
  sand: { en: "the predicted sand fraction", ne: "अनुमानित ढुस्सा प्रतिशत" },
  slope: { en: "the estimated slope", ne: "अनुमानित ढाल" },
} as const;

function missingList(keys: (keyof typeof MISSING)[]): Bi[] {
  return keys.map((key) => MISSING[key]);
}

// ---------------------------------------------------------------------------
// Shared derivations (mirror src/lib/server/decision.ts exactly)
// ---------------------------------------------------------------------------

export function rain72Fact(assessment: FieldAssessmentResponse): AskFact | null {
  const obs = assessment.rainfall_observation;
  if (obs) {
    if (obs.status !== "AVAILABLE" || obs.amount_mm === null) return null;
    const prov = obs.provenance ? provenanceFromRainfall("rainfall_72h", obs.provenance) : null;
    return makeFact("rainfall_72h", L.rain72, fmtNum(obs.amount_mm), "mm", prov);
  }
  const value = assessment.power_summary.rain_last_72h_mm;
  if (value === null) return null;
  return makeFact(
    "rainfall_72h",
    L.rain72,
    fmtNum(value),
    "mm",
    provenanceFromFreshness("rainfall_72h", assessment.power_summary.freshness, "model"),
  );
}

export function forecast48Fact(assessment: FieldAssessmentResponse): AskFact | null {
  const value = assessment.forecast.expected_rain_next_48h_mm;
  if (value === null) return null;
  return makeFact(
    "forecast_48h",
    L.forecast48,
    fmtNum(value),
    "mm",
    provenanceFromFreshness("forecast_48h", assessment.forecast.freshness, "forecast"),
  );
}

function surfaceWetnessFact(assessment: FieldAssessmentResponse): AskFact | null {
  const value = assessment.power_summary.latest_surface_wetness;
  if (value === null) return null;
  return makeFact(
    "surface_wetness",
    L.surfaceWetness,
    fmtNum(value, 2),
    "index",
    provenanceFromFreshness("surface_wetness", assessment.power_summary.freshness, "model"),
  );
}

function sandFact(assessment: FieldAssessmentResponse, override: number | null): { fact: AskFact | null; usedOverride: boolean } {
  if (override !== null && Number.isFinite(override)) {
    return {
      fact: makeFact("soil_sand", L.sand, fmtNum(override), "percent", farmerProvenance("soil_sand")),
      usedOverride: true,
    };
  }
  const value = assessment.soil_texture.sand_percent;
  if (value === null) return { fact: null, usedOverride: false };
  return {
    fact: makeFact(
      "soil_sand",
      L.sand,
      fmtNum(value),
      "percent",
      provenanceFromFreshness("soil_sand", assessment.soil_texture.freshness, "model"),
    ),
    usedOverride: false,
  };
}

function slopeFact(assessment: FieldAssessmentResponse): AskFact | null {
  const value = assessment.elevation.slope_percent;
  if (value === null) return null;
  return makeFact(
    "terrain_slope",
    L.slope,
    fmtNum(value),
    "percent",
    provenanceFromFreshness("terrain_slope", assessment.elevation.freshness, "model"),
  );
}

/** Verbatim engine reason -> stable key for bilingual rendering. */
function reasonKeyFromEngine(primary: string): SafeApplicationData["reasonKey"] {
  if (primary === "Rain-related conditions suggest waiting and checking again.") return "rain";
  if (primary === "Local soil and field review is recommended before deciding.") return "terrain";
  if (primary === "The available indicators do not trigger the prototype's rain or terrain cautions.") return "favorable";
  if (primary === "There is not enough reliable data to assess application timing.") return "missing_data";
  return "unknown";
}

function noAssessmentReason(): { en: string; ne: string } {
  return {
    en: "No field assessment is loaded. Run the assessment on the My field screen first.",
    ne: "खेतको मूल्याङ्कन लोड भएको छैन। पहिले मेरो खेत पृष्ठबाट मूल्याङ्कन चलाउनुहोस्।",
  };
}

// ---------------------------------------------------------------------------
// Tool: get_safe_application(field, answers)
// ---------------------------------------------------------------------------

export function getSafeApplication(context: AskFieldContext): AskToolResult<SafeApplicationData> {
  const assessment = context.assessment;
  if (!assessment) {
    return { available: false, data: null, unavailableReason: noAssessmentReason(), missing: [], provenance: [] };
  }

  const decision = assessment.decision;
  const rain = rain72Fact(assessment);
  const forecast = forecast48Fact(assessment);
  const wetness = surfaceWetnessFact(assessment);
  const sandResult = sandFact(assessment, context.answers.sandPercentOverride);
  const slope = slopeFact(assessment);

  const missing = missingList([
    ...(rain === null ? (["rain72"] as const) : []),
    ...(forecast === null ? (["forecast48"] as const) : []),
    ...(wetness === null ? (["surfaceWetness"] as const) : []),
    ...(sandResult.fact === null ? (["sand"] as const) : []),
    ...(slope === null ? (["slope"] as const) : []),
  ]);

  const facts: AskFact[] = [rain, forecast, wetness, sandResult.fact, slope].flatMap((fact) => (fact ? [fact] : []));
  const provenance: AskProvenance[] = facts.flatMap((fact) => (fact.provenance ? [fact.provenance] : []));

  return {
    available: true,
    data: {
      level: decision.signal,
      confidence: decision.confidence,
      waitDays: decision.wait_days_recommended,
      reasonEn: decision.primary_reason,
      reasonKey: reasonKeyFromEngine(decision.primary_reason),
      facts,
    },
    unavailableReason: null,
    missing,
    provenance,
  };
}

// ---------------------------------------------------------------------------
// Tool: get_conditions(field)
// ---------------------------------------------------------------------------

export function getConditions(context: AskFieldContext): AskToolResult<ConditionsData> {
  const assessment = context.assessment;
  if (!assessment) {
    return { available: false, data: null, unavailableReason: noAssessmentReason(), missing: [], provenance: [] };
  }

  const power = assessment.power_summary;
  const soil = assessment.soil_texture;
  const elevation = assessment.elevation;
  const sandResult = sandFact(assessment, context.answers.sandPercentOverride);

  const tempValue = power.latest_temp_c;
  const rootValue = power.latest_root_wetness;
  const elevationValue = elevation.elevation_meters;

  const siltValue = soil.silt_percent;
  const clayValue = soil.clay_percent;

  const data: ConditionsData = {
    usedRainfall: rain72Fact(assessment),
    temperatureC:
      tempValue === null
        ? null
        : makeFact("temperature", L.temperature, fmtNum(tempValue), "celsius", provenanceFromFreshness("temperature", power.freshness, "model")),
    surfaceWetness: surfaceWetnessFact(assessment),
    rootWetness:
      rootValue === null
        ? null
        : makeFact("root_wetness", L.rootWetness, fmtNum(rootValue, 2), "index", provenanceFromFreshness("root_wetness", power.freshness, "model")),
    sand: sandResult.fact,
    silt:
      siltValue === null
        ? null
        : makeFact("soil_silt", L.silt, fmtNum(siltValue), "percent", provenanceFromFreshness("soil_silt", soil.freshness, "model")),
    clay:
      clayValue === null
        ? null
        : makeFact("soil_clay", L.clay, fmtNum(clayValue), "percent", provenanceFromFreshness("soil_clay", soil.freshness, "model")),
    textureClass:
      soil.texture_class === null || soil.texture_class === ""
        ? null
        : makeFact("soil_texture_class", L.textureClass, soil.texture_class, "none", provenanceFromFreshness("soil_texture_class", soil.freshness, "model")),
    slopePercent: slopeFact(assessment),
    elevationM:
      elevationValue === null
        ? null
        : makeFact("elevation", L.elevation, fmtNum(elevationValue, 0), "metres", provenanceFromFreshness("elevation", elevation.freshness, "model")),
    usedFarmerSandOverride: sandResult.usedOverride,
  };

  const facts: AskFact[] = [
    data.usedRainfall,
    data.temperatureC,
    data.surfaceWetness,
    data.rootWetness,
    data.sand,
    data.silt,
    data.clay,
    data.textureClass,
    data.slopePercent,
    data.elevationM,
  ].flatMap((fact) => (fact ? [fact] : []));

  const missing = missingList([
    ...(data.usedRainfall === null ? (["rain72"] as const) : []),
    ...(data.surfaceWetness === null ? (["surfaceWetness"] as const) : []),
    ...(data.sand === null ? (["sand"] as const) : []),
  ]);

  return {
    available: true,
    data,
    unavailableReason: null,
    missing,
    provenance: facts.flatMap((fact) => (fact.provenance ? [fact.provenance] : [])),
  };
}

// ---------------------------------------------------------------------------
// Tool: get_forecast_summary(field)
// ---------------------------------------------------------------------------

function forecastDaysFacts(days: DailyForecastItem[]): ForecastSummaryData["days"] {
  return days.map((day) => ({
    date: day.date,
    mm:
      day.precipitation_sum_mm === null
        ? null
        : makeFact(`forecast_day_${day.date}`, { en: `Forecast rain on ${day.date}`, ne: `${day.date} को पूर्वानुमानित वर्षा` }, fmtNum(day.precipitation_sum_mm), "mm", null),
    chancePercent:
      day.precipitation_probability_max === null
        ? null
        : makeFact(`forecast_chance_${day.date}`, L.rainChance, fmtNum(day.precipitation_probability_max, 0), "percent", null),
  }));
}

export function getForecastSummary(context: AskFieldContext): AskToolResult<ForecastSummaryData> {
  const assessment = context.assessment;
  if (!assessment) {
    return { available: false, data: null, unavailableReason: noAssessmentReason(), missing: [], provenance: [] };
  }
  const forecast = assessment.forecast;
  if (!forecast.forecast_days.length && forecast.expected_rain_next_48h_mm === null) {
    return {
      available: false,
      data: null,
      unavailableReason: {
        en: "The rain forecast is not available right now.",
        ne: "वर्षा पूर्वानुमान अहिले उपलब्ध छैन।",
      },
      missing: [],
      provenance: [],
    };
  }

  const prov = provenanceFromFreshness("forecast", forecast.freshness, "forecast");
  const v48 = forecast.expected_rain_next_48h_mm;
  const v120 = forecast.expected_rain_next_120h_mm;

  const data: ForecastSummaryData = {
    next48mm: v48 === null ? null : makeFact("forecast_48h", L.forecast48, fmtNum(v48), "mm", prov),
    next120mm: v120 === null ? null : makeFact("forecast_120h", L.forecast120, fmtNum(v120), "mm", prov),
    rainExpectedSoon: forecast.rain_expected_soon,
    days: forecastDaysFacts(forecast.forecast_days),
    fetchedAt: prov.fetchedAt,
  };

  return {
    available: true,
    data,
    unavailableReason: null,
    missing: [],
    provenance: [prov],
  };
}

// ---------------------------------------------------------------------------
// Tool: get_rotation_plans(field, priorities)
// ---------------------------------------------------------------------------

export function getRotationPlans(_context: AskFieldContext): AskToolResult<null> {
  // The rotation module is intentionally not connected; the field and
  // priorities parameters exist to match the tool contract and are unused.
  void _context;
  return {
    available: false,
    data: null,
    unavailableReason: {
      en: "Crop rotation planning is not connected in this prototype.",
      ne: "यो प्रोटोटाइपमा बाली फेरबदल योजना जोडिएको छैन।",
    },
    missing: [{ en: "an expert-reviewed crop rotation module", ne: "विज्ञ-समीक्षित बाली फेरबदल मोड्युल" }],
    provenance: [],
  };
}

// ---------------------------------------------------------------------------
// Tool: get_content(crop)
// ---------------------------------------------------------------------------

/**
 * Restricted view over the optional source-verified content packs. Quantities
 * (doses, printed amounts) are NEVER exposed through this tool: hard rule 3
 * forbids the assistant to output doses or product-related quantities. Only
 * counts, crop names and review status pass through.
 */
export function getContent(context: AskFieldContext, crop: string | undefined): AskToolResult<ContentData> {
  if (!context.farmerContent) {
    return {
      available: false,
      data: null,
      unavailableReason: {
        en: "The source-verified content service is not connected right now.",
        ne: "स्रोत-प्रमाणित सामग्री सेवा अहिले जोडिएको छैन।",
      },
      missing: [{ en: "the content service", ne: "सामग्री सेवा" }],
      provenance: [],
    };
  }
  const content = context.farmerContent;
  const query = (crop ?? "").trim().toLowerCase();
  const refs = query
    ? content.fertilizer_references.filter((item) => item.crop.toLowerCase().includes(query))
    : content.fertilizer_references;
  const remedies = query
    ? content.home_remedies.filter((item) => item.crop.toLowerCase().includes(query))
    : content.home_remedies;
  const all = [...refs, ...remedies];
  const allExpertReviewed = all.length > 0 && all.every((item) => item.reviewStatus === "expert-reviewed" && item.reviewer);

  const crops = Array.from(new Set(all.map((item) => item.crop))).slice(0, 5);

  return {
    available: true,
    data: {
      cropQuery: crop ?? "",
      fertilizerRefCount: refs.length,
      homeRemedyCount: remedies.length,
      allExpertReviewed,
      sampleCrops: crops,
    },
    unavailableReason: null,
    missing: [],
    provenance: [],
  };
}

// ---------------------------------------------------------------------------
// Tool: get_provenance(valueId)
// ---------------------------------------------------------------------------

export const PROVENANCE_VALUE_IDS: readonly string[] = [
  "rainfall_72h",
  "temperature",
  "surface_wetness",
  "root_wetness",
  "soil_texture",
  "terrain_slope",
  "forecast",
];

export function getProvenance(context: AskFieldContext, slots: AskSlots): AskToolResult<AskProvenance> {
  const assessment = context.assessment;
  if (!assessment) {
    return { available: false, data: null, unavailableReason: noAssessmentReason(), missing: [], provenance: [] };
  }
  const id = (slots.valueId ?? "").trim();
  const rainObs = assessment.rainfall_observation;
  switch (id) {
    case "rainfall_72h": {
      if (rainObs?.provenance) {
        return { available: true, data: provenanceFromRainfall("rainfall_72h", rainObs.provenance), unavailableReason: null, missing: [], provenance: [] };
      }
      return { available: true, data: provenanceFromFreshness("rainfall_72h", assessment.power_summary.freshness, "model"), unavailableReason: null, missing: [], provenance: [] };
    }
    case "temperature":
      return { available: true, data: provenanceFromFreshness("temperature", assessment.power_summary.freshness, "model"), unavailableReason: null, missing: [], provenance: [] };
    case "surface_wetness":
      return { available: true, data: provenanceFromFreshness("surface_wetness", assessment.power_summary.freshness, "model"), unavailableReason: null, missing: [], provenance: [] };
    case "root_wetness":
      return { available: true, data: provenanceFromFreshness("root_wetness", assessment.power_summary.freshness, "model"), unavailableReason: null, missing: [], provenance: [] };
    case "soil_texture":
      return { available: true, data: provenanceFromFreshness("soil_texture", assessment.soil_texture.freshness, "model"), unavailableReason: null, missing: [], provenance: [] };
    case "terrain_slope":
      return { available: true, data: provenanceFromFreshness("terrain_slope", assessment.elevation.freshness, "model"), unavailableReason: null, missing: [], provenance: [] };
    case "forecast":
      return { available: true, data: provenanceFromFreshness("forecast", assessment.forecast.freshness, "forecast"), unavailableReason: null, missing: [], provenance: [] };
    default:
      return {
        available: false,
        data: null,
        unavailableReason: {
          en: `I do not know that data item. Known items: ${PROVENANCE_VALUE_IDS.join(", ")}.`,
          ne: `त्यो डाटा वस्तु थाहा छैन। थाहा भएका वस्तु: ${PROVENANCE_VALUE_IDS.join(", ")}।`,
        },
        missing: [],
        provenance: [],
      };
  }
}

// ---------------------------------------------------------------------------
// Tool: get_glossary(term)
// ---------------------------------------------------------------------------

export function getGlossaryTerm(term: string | undefined): AskToolResult<GlossaryEntry> {
  const entry = findGlossaryEntry(term);
  if (!entry) {
    return {
      available: false,
      data: null,
      unavailableReason: {
        en: `I do not have that term in my list. Terms I can explain: ${glossaryTermNames().join(", ")}.`,
        ne: `यो शब्द मेरो सूचीमा छैन। म बुझाउन सक्ने शब्द: ${glossaryTermNames().join(", ")}।`,
      },
      missing: [{ en: "the requested term", ne: "मागिएको शब्द" }],
      provenance: [],
    };
  }
  return { available: true, data: entry, unavailableReason: null, missing: [], provenance: [] };
}

function glossaryTermNames(): string[] {
  return GLOSSARY_TERMS.map((entry) => entry.term);
}

// ---------------------------------------------------------------------------
// Tool: get_data_status()
// ---------------------------------------------------------------------------

export function getDataStatus(context: AskFieldContext): AskToolResult<DataSourceStatus[]> {
  const assessment = context.assessment;
  if (!assessment) {
    return { available: false, data: null, unavailableReason: noAssessmentReason(), missing: [], provenance: [] };
  }

  const rows: DataSourceStatus[] = [];
  const badge = (valueId: string, b: FreshnessBadgeData): DataSourceStatus => ({
    valueId,
    datasetName: b.dataset_name,
    sourceOrg: b.source_org,
    isNasa: b.is_nasa,
    status: b.status,
    latestObservation: b.latest_observation_date,
    fetchedAt: b.fetched_at_utc,
    resolution: b.spatial_resolution,
    latencyNote: b.typical_latency,
  });

  rows.push(badge("rainfall_72h", assessment.power_summary.freshness));
  rows.push(badge("temperature", assessment.power_summary.freshness));
  rows.push(badge("soil_texture", assessment.soil_texture.freshness));
  rows.push(badge("terrain_slope", assessment.elevation.freshness));
  rows.push(badge("forecast", assessment.forecast.freshness));
  if (assessment.rainfall_observation?.provenance) {
    rows.push({
      valueId: "rainfall_source_detail",
      datasetName: assessment.rainfall_observation.provenance.dataset,
      sourceOrg: assessment.rainfall_observation.provenance.source_name,
      isNasa: /NASA|IMERG|GPM|POWER/i.test(assessment.rainfall_observation.provenance.source_name),
      status: "LIVE",
      latestObservation: assessment.rainfall_observation.provenance.observed_end_utc,
      fetchedAt: assessment.rainfall_observation.provenance.fetched_at_utc,
      resolution: assessment.rainfall_observation.provenance.spatial_resolution,
      latencyNote: assessment.rainfall_observation.provenance.latency_note,
    });
  }

  return { available: true, data: rows, unavailableReason: null, missing: [], provenance: [] };
}
