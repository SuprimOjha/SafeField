export type SourceStatus = "LIVE" | "CACHED_FALLBACK" | "UNAVAILABLE";

export interface FreshnessBadgeData {
  dataset_name: string;
  source_org: string;
  is_nasa: boolean;
  status: SourceStatus;
  latest_observation_date: string | null;
  fetched_at_utc: string;
  typical_latency: string;
  spatial_resolution: string;
  caveat: string;
  docs_url: string;
}

export interface DailyWeatherRecord {
  date: string;
  precip_mm: number | null;
  temp_c: number | null;
  temp_max_c?: number | null;
  temp_min_c?: number | null;
  surface_soil_wetness: number | null;
  root_soil_wetness: number | null;
}

export type SignalName =
  | "rain"
  | "soil_moisture_surface"
  | "soil_moisture_root"
  | "heat_air"
  | "heat_surface"
  | "ndvi"
  | "evi";

export type SignalKind =
  | "observation"
  | "model"
  | "forecast"
  | "fallback"
  | "cached"
  | "farmer_input"
  | "assumption";

export type SignalStatus = "available" | "partial" | "stale" | "unavailable" | "not_installed";

export type VsNormal = "much_below" | "below" | "near_normal" | "above" | "much_above" | "unknown";

export interface SignalProvenance {
  source_name: string;
  product: string;
  version: string;
  kind: SignalKind;
  is_nasa: boolean;
  valid_date: string | null;
  observed_start: string | null;
  observed_end: string | null;
  fetched_at: string;
  spatial_resolution: string;
  latency_note: string;
  granule_ids?: string[];
  coverage_fraction?: number | null;
  model_only?: boolean | null;
  source_key?: string | null;
  caveat: string;
}

export interface SignalValue {
  name: SignalName;
  status: SignalStatus;
  value: number | null;
  unit: string | null;
  vs_normal: VsNormal;
  anomaly: number | null;
  baseline: number | null;
  baseline_years: number;
  provenance: SignalProvenance | null;
  unavailable_reason: string | null;
  quality_note: string | null;
}

export interface SignalBundle {
  latitude: number;
  longitude: number;
  generated_at: string;
  signals: Partial<Record<SignalName, SignalValue>>;
  warnings: string[];
}

export type AgreementState = "agree" | "partial" | "disagree" | "insufficient_sources" | "not_comparable";

export interface AgreementSource {
  source_name: string;
  amount_mm: number;
  kind: SignalKind;
  is_nasa: boolean;
  window_hours: number;
  observed_end_date: string;
  spatial_resolution: string | null;
}

export interface SourceAgreement {
  topic: "rain" | "soil_moisture";
  state: AgreementState;
  sources: AgreementSource[];
  spread_mm: number | null;
  tolerance_note: string;
  summary: string;
  assumption_note: string;
}

export type RainImpactClass = "heavy_recent" | "heavy_forecast" | "none" | "unknown";

export interface RainImpact {
  classification: RainImpactClass;
  rain_24h_mm: number | null;
  rain_72h_mm: number | null;
  forecast_48h_mm: number | null;
  thresholds: Record<string, number>;
  summary: string;
  assumption_note: string;
}

export type StressFactorName = "water" | "heat" | "vegetation" | "rain";
export type FactorState = "watch" | "no_watch" | "unknown";

export interface StressFactor {
  factor: StressFactorName;
  state: FactorState;
  evidence: string[];
  reason: string;
}

export interface StressWatch {
  overall: FactorState;
  factors: StressFactor[];
  summary: string;
  disclaimer: string;
}

export interface PowerSummaryResponse {
  latitude: number;
  longitude: number;
  freshness: FreshnessBadgeData;
  rain_last_24h_mm: number | null;
  rain_last_72h_mm: number | null;
  latest_surface_wetness: number | null;
  latest_root_wetness: number | null;
  latest_temp_c: number | null;
  recent_daily_records: DailyWeatherRecord[];
  historical_daily_records: DailyWeatherRecord[];
}

export interface ElevationResponse {
  latitude: number;
  longitude: number;
  elevation_meters: number | null;
  slope_percent: number | null;
  terrain_category: string;
  freshness: FreshnessBadgeData;
}

export interface SoilTextureResponse {
  latitude: number;
  longitude: number;
  clay_percent: number | null;
  silt_percent: number | null;
  sand_percent: number | null;
  texture_class: string;
  freshness: FreshnessBadgeData;
}

export interface DailyForecastItem {
  date: string;
  precipitation_sum_mm: number | null;
  precipitation_probability_max: number | null;
  temperature_2m_max_c?: number | null;
  temperature_2m_min_c?: number | null;
  wind_speed_10m_max_kmh?: number | null;
  weather_code?: number | null;
  precipitation_hours?: number | null;
}

export interface ForecastResponse {
  latitude: number;
  longitude: number;
  freshness: FreshnessBadgeData;
  forecast_days: DailyForecastItem[];
  expected_rain_next_48h_mm: number | null;
  expected_rain_next_120h_mm: number | null;
  rain_expected_soon: boolean | null;
}

export type DecisionSignal = "CONDITIONS LOOK SUITABLE" | "WAIT AND RECHECK" | "LOCAL REVIEW NEEDED";
export type ConfidenceLevel = "HIGH" | "MODERATE" | "CAUTION";

export interface RuleContribution {
  parameter: string;
  observed_value: string;
  impact: "FAVORABLE" | "RISKY" | "NEUTRAL";
  explanation: string;
  evidence_status?: string;
}

export interface DecisionResult {
  signal: DecisionSignal;
  confidence: ConfidenceLevel;
  wait_days_recommended: number;
  primary_reason: string;
  detailed_explanation: string;
  rule_contributions: RuleContribution[];
  disclaimer: string;
}

export interface TrendAnalysisResult {
  variable_name: string;
  years_analyzed: number;
  total_observations: number;
  raw_slope_per_decade: number;
  theil_sen_slope_per_decade: number;
  confidence_interval_lower: number;
  confidence_interval_upper: number;
  mann_kendall_p_value: number;
  corrected_p_value: number;
  significant_before_fdr: boolean;
  significant_after_fdr: boolean;
  plain_language_summary: string;
}

export interface RainfallProvenance {
  source_name: string;
  kind: "observation" | "model" | "forecast" | "fallback" | "farmer_input" | "assumption";
  observed_start_utc: string;
  observed_end_utc: string;
  fetched_at_utc: string;
  spatial_resolution: string | null;
  latency_note: string;
  dataset: string;
  version: string;
  stream?: string | null;
  granule_ids: string[];
  units: string;
  spatial_method: "nearest_grid_cell" | "area_weighted_polygon" | "point_grid";
  coverage_fraction: number | null;
}

export interface RainfallObservation {
  status: "AVAILABLE" | "UNAVAILABLE";
  amount_mm: number | null;
  window_hours: number;
  provenance: RainfallProvenance | null;
  unavailable_reason: string | null;
  /** Optional sanitized technical detail (shown only in a collapsed disclosure). */
  unavailable_detail?: string | null;
}

export interface ContentSource {
  title: string;
  authority: string;
  year: number;
  url: string;
  accessed: string;
  official: boolean;
  language: string;
}

export interface FertilizerReference {
  id: string;
  crop: string;
  varietyType: string;
  region: string;
  nutrientOrProduct: string;
  basis: "nutrient" | "product";
  valueMin: number | null;
  valueMax: number | null;
  unitAsPrinted: string;
  timingSplit: string;
  sourceKey: string;
  secondSourceKey: string | null;
  year: number;
  page: string;
  shortQuote: string;
  confidence: "single-source" | "two-sources";
  verified: boolean;
  reviewStatus: "not-expert-reviewed" | "expert-reviewed";
  reviewer: string | null;
}

export interface HomeRemedy {
  id: string;
  crop: string;
  problem: string;
  remedyText: string;
  quantitiesAsPrinted: string | null;
  preparationNotesAsPrinted: string | null;
  sourceKey: string;
  evidence: "official" | "research" | "extension";
  verified: boolean;
  safetyNotes: string;
  reviewStatus: "not-expert-reviewed" | "expert-reviewed";
  reviewer: string | null;
}

export interface FarmerContentResponse {
  status: "ok" | "partial" | "error";
  sources: Record<string, ContentSource>;
  fertilizer_references: FertilizerReference[];
  home_remedies: HomeRemedy[];
  conversions: { unit: "ropani" | "bigha" | "kattha" | "hectare"; toHectare: number | null; sourceKey: string; verified: boolean }[];
  skipped: Record<string, number>;
  warnings: string[];
}

export interface FieldAssessmentResponse {
  rainfall_observation: RainfallObservation;
  latitude: number;
  longitude: number;
  power_summary: PowerSummaryResponse;
  elevation: ElevationResponse;
  soil_texture: SoilTextureResponse;
  forecast: ForecastResponse;
  decision: DecisionResult;
  climate_trend: TrendAnalysisResult;
  /** Present on responses built by this app; older backends omit it. */
  signals?: SignalBundle;
  rain_agreement?: SourceAgreement;
  rain_impact?: RainImpact;
  stress_watch?: StressWatch;
}