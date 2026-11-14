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
  surface_soil_wetness: number | null;
  root_soil_wetness: number | null;
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
}

export interface RainfallObservation {
  status: "AVAILABLE" | "UNAVAILABLE";
  amount_mm: number | null;
  window_hours: number;
  provenance: RainfallProvenance | null;
  unavailable_reason: string | null;
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
}