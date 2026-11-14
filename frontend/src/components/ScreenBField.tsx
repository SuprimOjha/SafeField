"use client";

import React from "react";
import { FieldAssessmentResponse } from "@/types/safefield";
import { CloudRain, Droplets, Thermometer, Mountain, CheckCircle2, RefreshCw, ArrowRight } from "lucide-react";
import { getDict, type Lang } from "@/i18n";

interface ScreenBFieldProps {
  data: FieldAssessmentResponse | null;
  loading: boolean;
  error: string | null;
  fertilizerType: string;
  setFertilizerType: (val: string) => void;
  cropStage: string;
  setCropStage: (val: string) => void;
  sandPercentOverride: number | null;
  onSandOverrideChange: (val: number | null) => void;
  onRunAssessment: () => void;
  onProceedToDecision: () => void;
  lang: Lang;
}

export default function ScreenBField({
  data,
  loading,
  error,
  fertilizerType,
  setFertilizerType,
  cropStage,
  setCropStage,
  sandPercentOverride,
  onSandOverrideChange,
  onRunAssessment,
  onProceedToDecision,
  lang,
}: ScreenBFieldProps) {
  const t = getDict(lang);

  if (loading) {
    return (
      <div role="status" aria-live="polite" className="bg-white p-12 rounded-2xl shadow-sm border border-emerald-100 text-center space-y-4">
        <RefreshCw className="w-10 h-10 text-emerald-700 animate-spin mx-auto" />
        <h3 className="text-xl font-bold text-emerald-900">{t.loadingAssessment}</h3>
        <p className="text-gray-600 text-sm">{t.loadingAssessmentBody}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div role="alert" aria-live="assertive" className="bg-white p-8 sm:p-12 rounded-2xl shadow-sm border border-amber-200 text-center space-y-4">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-700">
          <RefreshCw className="h-6 w-6" />
        </div>
        <h3 className="text-xl font-bold text-slate-900">{t.assessmentFailed}</h3>
        <p className="mx-auto max-w-2xl text-sm leading-6 text-slate-600">
          {error || t.assessmentFailedBody}
        </p>
        <button
          type="button"
          onClick={onRunAssessment}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-700 px-6 py-3 font-semibold text-white transition hover:bg-emerald-800"
        >
          <RefreshCw className="h-4 w-4" />
          {t.retryAssessment}
        </button>
      </div>
    );
  }

  const { power_summary, elevation, soil_texture } = data;
  const rainfall = data.rainfall_observation;
  const hasLocalRainfall = rainfall.status === "AVAILABLE" && rainfall.amount_mm !== null;
  const regionalPowerRainDays = power_summary.recent_daily_records
    .filter((record) => record.precip_mm !== null)
    .slice(-3);
  const hasRegionalPowerEstimate =
    !hasLocalRainfall &&
    power_summary.rain_last_72h_mm !== null &&
    regionalPowerRainDays.length === 3;
  const regionalPowerDates = regionalPowerRainDays.map((record) => record.date).join(", ");
  const sandVal = sandPercentOverride ?? soil_texture.sand_percent ?? "";
  const sandLabel =
    sandPercentOverride !== null
      ? `${sandPercentOverride}${t.sandFarmerOverride}`
      : soil_texture.sand_percent !== null
        ? `${soil_texture.sand_percent}${t.sandSoilgrids}`
        : t.sandUnavailable;

  return (
    <div className="space-y-6">
      {/* Freshness banner */}
      <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-xl flex items-center justify-between text-xs text-emerald-900">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
          <span>
            <strong>{power_summary.freshness.dataset_name}</strong> | {t.freshnessLatest} {power_summary.freshness.latest_observation_date || "N/A"} ({power_summary.freshness.status})
          </span>
        </div>
        <span className="text-emerald-700 font-mono hidden md:inline">{t.freshnessLatency} {power_summary.freshness.typical_latency}</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Local rainfall observation */}
        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-gray-600">{t.localRainfall}</span>
            <CloudRain className="w-6 h-6 text-sky-600" />
          </div>
          {hasLocalRainfall ? (
            <div>
              <span className="text-3xl font-bold text-gray-900">{rainfall.amount_mm}</span>
              <span className="text-gray-500 ml-1">mm</span>
            </div>
          ) : (
            <div>
              <span className="text-xl font-bold text-amber-800">{t.notVerified}</span>
            </div>
          )}
          <p className="text-xs text-gray-500 mt-2">
            {hasLocalRainfall && rainfall.provenance
              ? rainfall.provenance.source_name +
                " · " +
                rainfall.provenance.observed_start_utc.slice(0, 10) +
                " → " +
                rainfall.provenance.observed_end_utc.slice(0, 10) +
                " · " +
                rainfall.provenance.spatial_method
              : t.noRainfallObservation}
          </p>
          {hasRegionalPowerEstimate && (
            <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold text-slate-700">{t.regionalEstimateOnly}</p>
              <p className="mt-1 text-xs leading-5 text-slate-600">
                {power_summary.rain_last_72h_mm} {t.regionalEstimateBody.replace("{dates}", regionalPowerDates)}{" "}
                {power_summary.freshness.spatial_resolution} {t.regionalEstimateTail}
              </p>
            </div>
          )}
        </div>

        {/* Soil Wetness */}
        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-gray-600">{t.wetnessCard}</span>
            <Droplets className="w-6 h-6 text-emerald-600" />
          </div>
          <div>
            <span className="text-3xl font-bold text-gray-900">
              {power_summary.latest_surface_wetness !== null ? Math.round(power_summary.latest_surface_wetness * 100) : "N/A"}
            </span>
            <span className="text-gray-500 ml-1">%</span>
          </div>
          <span className="text-xs text-gray-400 mt-2">{t.wetnessNote}</span>
        </div>

        {/* Temperature */}
        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-gray-600">{t.temperatureCard}</span>
            <Thermometer className="w-6 h-6 text-amber-600" />
          </div>
          <div>
            <span className="text-3xl font-bold text-gray-900">{power_summary.latest_temp_c ?? "N/A"}</span>
            <span className="text-gray-500 ml-1">°C</span>
          </div>
          <span className="text-xs text-gray-400 mt-2">{t.temperatureNote}</span>
        </div>

        {/* Slope & Terrain */}
        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-gray-600">{t.terrainCard}</span>
            <Mountain className="w-6 h-6 text-stone-600" />
          </div>
          <div>
            <span className="text-3xl font-bold text-gray-900">{elevation.slope_percent ?? "N/A"}%</span>
            <span className="text-xs text-emerald-800 font-semibold block mt-1">{elevation.terrain_category}</span>
          </div>
          <span className="text-xs text-gray-400 mt-2">{t.terrainNote}</span>
        </div>
      </div>

      <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-950">{t.screenBCaveat}</p>

      {/* Input Configuration Card */}
      <div className="bg-white p-6 rounded-2xl border border-emerald-100 shadow-sm space-y-6">
        <h3 className="text-xl font-bold text-emerald-900">{t.selectFertilizer}</h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Fertilizer Type */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              {t.fertilizerType}
            </label>
            <select
              value={fertilizerType}
              onChange={(e) => setFertilizerType(e.target.value)}
              className="w-full bg-gray-50 border border-gray-300 rounded-xl px-4 py-3 font-medium text-gray-900 focus:ring-2 focus:ring-emerald-600"
            >
              <option value="Urea">{t.fertilizerUrea}</option>
              <option value="DAP">{t.fertilizerDap}</option>
              <option value="Compost/FYM">{t.fertilizerCompost}</option>
            </select>
          </div>

          {/* Crop Stage */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              {t.cropStage}
            </label>
            <select
              value={cropStage}
              onChange={(e) => setCropStage(e.target.value)}
              className="w-full bg-gray-50 border border-gray-300 rounded-xl px-4 py-3 font-medium text-gray-900 focus:ring-2 focus:ring-emerald-600"
            >
              <option value="Basal / Planting">{t.stageBasal}</option>
              <option value="Vegetative / Tillering">{t.stageVegetative}</option>
              <option value="Flowering / Grain Filling">{t.stageFlowering}</option>
            </select>
          </div>

          {/* Soil Texture / Sand Slider */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              {t.soilTexture}: {sandLabel}
            </label>
            <input
              type="number"
              min="0"
              max="100"
              step="1"
              value={sandVal}
              onChange={(e) => { const raw = e.target.value; if (raw === "") { onSandOverrideChange(null); return; } const value = Number(raw); if (Number.isFinite(value) && value >= 0 && value <= 100) onSandOverrideChange(value); }}
              className="w-full rounded-xl border border-gray-300 bg-gray-50 px-4 py-3 font-medium text-gray-900 focus:ring-2 focus:ring-emerald-600"
            />
            <span className="text-xs text-gray-500 mt-1 block">
              {t.soilHelperPrefix} {soil_texture.sand_percent === null ? t.soilHelperUnavailable : `${soil_texture.texture_class} (${soil_texture.sand_percent}% sand)`}.
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row justify-between items-center gap-4 pt-4 border-t border-gray-100">
          <button
            onClick={onRunAssessment}
            className="flex items-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-800 px-6 py-3 rounded-xl font-semibold transition"
          >
            <RefreshCw className="w-4 h-4" />
            {t.rerunAssessment}
          </button>

          <button
            onClick={onProceedToDecision}
            className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white px-8 py-4 rounded-xl font-bold text-lg shadow-md transition"
          >
            {t.nextDecision}
            <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
