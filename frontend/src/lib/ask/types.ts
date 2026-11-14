// Ask assistant — core types (Work Package 1).
//
// The assistant is a GROUNDED EXPLAINER: every decision word and number comes
// from the deterministic tools in ./tools.ts. A language model (L1) may only
// reword an already-computed answer; at L0 no model is involved at all.
//
// Rule references in comments follow PRD section 9 hard rules and TRD
// operating rules supplied in the Ask assistant specification.

import type { ConfidenceLevel, DecisionSignal, FarmerContentResponse, FieldAssessmentResponse } from "../../types/safefield";

/** App languages supported by the assistant. Hindi is NOT allowed before native review. */
export type AskLang = "en" | "ne";

/** Bilingual string pair used by every assistant string (i18n parity requirement). */
export interface Bi {
  en: string;
  ne: string;
}

/**
 * The only things the assistant may answer (fixed list; L3 free-text advice is
 * never built). "unknown" always maps to the fixed refusal.
 * irrigation_timing_hint and fertilizer_timing_window are P1 and currently
 * return honest unavailable answers naming what is missing.
 */
export type AskIntent =
  | "can_apply_today"
  | "check_soil"
  | "rain_this_week"
  | "stay_safe"
  | "explain_card"
  | "explain_term"
  | "data_source"
  | "explain_rotation"
  | "what_changed"
  | "irrigation_timing_hint"
  | "fertilizer_timing_window"
  | "unknown";

/** Unit codes so each language can render the unit in its own words (read-aloud rule 9). */
export type AskUnit = "mm" | "percent" | "celsius" | "metres" | "hours" | "index" | "none";

/** Data kind that must accompany every number an answer states (hard rule 4). */
export type AskValueKind =
  | "observation"
  | "model"
  | "forecast"
  | "fallback"
  | "cached"
  | "farmer_input";

/** Normalized provenance carried into every answer that states a number. */
export interface AskProvenance {
  /** Stable value identifier, e.g. "rainfall_72h", "forecast_48h", "soil_sand". */
  valueId: string;
  /** Source organisation or dataset name, e.g. "NASA GPM IMERG Late", "ISRIC SoilGrids". */
  source: string;
  /** Non-NASA sources must be labelled as non-NASA (hard rule 4). */
  isNasa: boolean;
  kind: AskValueKind;
  /** Observation/validity window start (ISO) when the source provides one. */
  validFrom: string | null;
  /** Observation/validity window end (ISO) when the source provides one. */
  validTo: string | null;
  /** When the value was fetched by the app (ISO). */
  fetchedAt: string | null;
  /** Spatial resolution description, e.g. "0.1 deg (~10 km)". */
  resolution: string | null;
  /** Latency note from the source, when provided. */
  latencyNote: string | null;
}

/** One value shown in an answer, with its bilingual label and provenance. */
export interface AskFact {
  id: string;
  label: Bi;
  /** Numeric value rendered as a plain string, e.g. "18.4", "62.3". Null when unavailable. */
  value: string | null;
  /** Unit code; rendered per language by factSentence. */
  unit: AskUnit;
  provenance: AskProvenance | null;
}

/** A clarifying-question option (hard rule 6: ONE short question, 2-3 buttons). */
export interface AskClarificationOption {
  id: string;
  label: Bi;
  /** Intent answered when the farmer taps this option. */
  intent: AskIntent;
  /** Slot values passed to buildAskResponse, e.g. { cardId: "rainfall" }. */
  slot?: Record<string, string>;
}

/** Rule 6 clarifying question with 2-3 answer buttons; the assistant never guesses. */
export interface AskClarification {
  question: Bi;
  options: AskClarificationOption[];
}

/**
 * Response scopes:
 * - answer:      grounded L0 answer (facts carry source/kind/date)
 * - unavailable: tool data missing; names plainly what is missing (rule 1)
 * - clarification: rule 6 question with answer buttons
 * - refusal:     fixed refusal for unknown/out-of-scope (rule 7)
 * - medical:     poisoning/illness referral message (rule 8)
 */
export type AskScope = "answer" | "unavailable" | "clarification" | "refusal" | "medical";

export interface AskResponse {
  scope: AskScope;
  intent: AskIntent;
  language: AskLang;
  /** Plain text, read-aloud safe: short sentences, no emojis, no markdown symbols (rule 9). */
  text: string;
  /** Decision-level word EXACTLY as the tool returned it (rule 2), when applicable. */
  level: string | null;
  facts: AskFact[];
  /** Named missing items, in both languages (rule 1). */
  missing: Bi[];
  /** "Follow the product label." reminder where application advice appears (rule 5). */
  requiresLabelReminder: boolean;
  /** Review banner must be shown while no expert review record exists (rule 5). */
  requiresReviewBanner: boolean;
  /** Set on the medical referral path; message is marked for expert review (rule 8). */
  markedForExpertReview: boolean;
  /** Always false at L0; L1 wording layer sets true only when it was actually used. */
  aiAssisted: boolean;
  clarification: AskClarification | null;
}

/** Farmer answers already collected by the app (Screen B); all are farmer input. */
export interface AskFarmerAnswers {
  fertilizerType: string;
  cropStage: string;
  saveMoney: boolean;
  sandPercentOverride: number | null;
}

/**
 * Everything the deterministic tools may read. Tools have NO other data access
 * (TRD operating rule): no model output, no free text, no external calls.
 */
export interface AskFieldContext {
  latitude: number;
  longitude: number;
  answers: AskFarmerAnswers;
  /** Current field assessment already loaded by the app (may be null). */
  assessment: FieldAssessmentResponse | null;
  /** Previous saved assessment used only by the what_changed intent. */
  previousAssessment: FieldAssessmentResponse | null;
  /** Optional source-verified content packs; quantities are never exposed. */
  farmerContent: FarmerContentResponse | null;
}

/** Optional slots disambiguating explain_card / explain_term / data_source. */
export interface AskSlots {
  cardId?: string;
  term?: string;
  valueId?: string;
}

/** Tool result envelope; every tool is deterministic and offline of any model. */
export interface AskToolResult<T> {
  available: boolean;
  data: T | null;
  /** Bilingual reason the tool has nothing usable (rule 1: say so plainly). */
  unavailableReason: Bi | null;
  /** Bilingual names of the missing inputs (rule 1: name what is missing). */
  missing: Bi[];
  provenance: AskProvenance[];
}

/** Decision data returned by get_safe_application. */
export interface SafeApplicationData {
  /** EXACTLY as the deterministic engine returned it (rule 2). */
  level: DecisionSignal;
  confidence: ConfidenceLevel;
  waitDays: number;
  /** Verbatim English primary reason from the engine. */
  reasonEn: string;
  /** Stable key for the known engine reasons, for bilingual rendering. */
  reasonKey: "rain" | "terrain" | "favorable" | "missing_data" | "unknown";
  facts: AskFact[];
}

/** Current-condition data returned by get_conditions. */
export interface ConditionsData {
  usedRainfall: AskFact | null;
  temperatureC: AskFact | null;
  surfaceWetness: AskFact | null;
  rootWetness: AskFact | null;
  sand: AskFact | null;
  silt: AskFact | null;
  clay: AskFact | null;
  textureClass: AskFact | null;
  slopePercent: AskFact | null;
  elevationM: AskFact | null;
  /** True when the screening used the farmer sand override instead of SoilGrids. */
  usedFarmerSandOverride: boolean;
}

/** Forecast data returned by get_forecast_summary. */
export interface ForecastSummaryData {
  next48mm: AskFact | null;
  next120mm: AskFact | null;
  rainExpectedSoon: boolean | null;
  days: { date: string; mm: AskFact | null; chancePercent: AskFact | null }[];
  fetchedAt: string | null;
}

/** Restricted content data returned by get_content. Quantities are NEVER included. */
export interface ContentData {
  cropQuery: string;
  fertilizerRefCount: number;
  homeRemedyCount: number;
  allExpertReviewed: boolean;
  sampleCrops: string[];
}

/** One dataset status line returned by get_data_status. */
export interface DataSourceStatus {
  valueId: string;
  datasetName: string;
  sourceOrg: string;
  isNasa: boolean;
  status: "LIVE" | "CACHED_FALLBACK" | "UNAVAILABLE" | "NOT_LOADED";
  latestObservation: string | null;
  fetchedAt: string | null;
  resolution: string | null;
  latencyNote: string | null;
}

/** Glossary entry (get_glossary). Definitions stay inside the app's own methods vocabulary. */
export interface GlossaryEntry {
  id: string;
  term: string;
  aliases: string[];
  definition: Bi;
}
