"use client";

import React from "react";
import { FieldAssessmentResponse } from "@/types/safefield";
import { CloudRain, Droplets, Thermometer, Mountain, CheckCircle2, RefreshCw, ArrowRight, MapPinned } from "lucide-react";
import { getDict, type Lang } from "@/i18n";
import FreshnessStrip from "@/components/FreshnessStrip";
import DataReceiptDrawer from "@/components/DataReceiptDrawer";
import FarmerLogbook from "@/components/FarmerLogbook";
import SignalTiles from "@/components/SignalTiles";
import SourceAgreementBadge from "@/components/SourceAgreementBadge";
import StressWatchBanner from "@/components/StressWatchBanner";
import DataClock from "@/components/DataClock";

interface ScreenBFieldProps {
  hasField: boolean;
  onSelectField: () => void;
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
  hasField,
  onSelectField,
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

  if (!hasField) {
    return (
      <section className="mx-auto w-full max-w-2xl rounded-2xl border border-[#C7E0FF] bg-brand-blue-soft p-6 shadow-card sm:p-8" aria-labelledby="field-gate-title">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-brand-blue-deep shadow-card">
          <MapPinned className="h-6 w-6" aria-hidden="true" />
        </span>
        <h2 id="field-gate-title" className="mt-3 text-2xl font-bold tracking-tight text-brand-blue-deep">{t.fieldNeedsFieldTitle}</h2>
        <p className="mt-2 text-sm leading-6 text-ink-soft">{t.fieldNeedsFieldBody}</p>
        <button
          type="button"
          onClick={onSelectField}
          className="mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-action px-5 text-sm font-bold text-white transition hover:bg-action-pressed active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 sm:w-auto"
        >
          <MapPinned className="h-4 w-4" aria-hidden="true" />
          {t.fieldNeedsFieldCta}
        </button>
      </section>
    );
  }

  if (loading) {
    return (
      <div role="status" aria-live="polite" className="rounded-2xl border border-line bg-white p-12 text-center shadow-card space-y-4">
        <RefreshCw className="w-10 h-10 text-action animate-spin mx-auto" />
        <h3 className="text-xl font-bold text-ink">{t.loadingAssessment}</h3>
        <p className="text-ink-soft text-sm">{t.loadingAssessmentBody}</p>
      </div>
    );
  }

  if (!data) {
    const notRun = !error;
    return (
      <div role={notRun ? "status" : "alert"} aria-live={notRun ? "polite" : "assertive"} className="rounded-2xl border border-amber bg-white p-8 text-center shadow-card space-y-4 sm:p-12">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-soft text-amber-ink">
          <RefreshCw className="h-6 w-6" />
        </div>
        <h3 className="text-xl font-bold text-ink">{notRun ? t.fieldNoAssessmentTitle : t.assessmentFailed}</h3>
        <p className="mx-auto max-w-2xl text-sm leading-6 text-ink-soft">
          {notRun ? t.fieldNoAssessmentBody : (error || t.assessmentFailedBody)}
        </p>
        <button
          type="button"
          onClick={onRunAssessment}
          className="inline-flex items-center justify-center gap-2 rounded-full bg-action px-6 py-3 font-semibold text-white transition hover:bg-action-pressed active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw className="h-4 w-4" />
          {notRun ? t.homeRunAssessment : t.retryAssessment}
        </button>
      </div>
    );
  }

  const { power_summary, elevation, soil_texture } = data;
  const rainfall = data.rainfall_observation;
  const freshnessStatusWord =
    power_summary.freshness.status === "LIVE"
      ? t.freshnessStatusLive
      : power_summary.freshness.status === "CACHED_FALLBACK"
        ? t.freshnessStatusCached
        : t.freshnessStatusUnavailable;
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
      <header className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-blue-soft text-brand-blue-deep">
          <MapPinned className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">{t.fieldScreenTitle}</h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-ink-soft">{t.fieldScreenSubtitle}</p>
        </div>
      </header>
      <FreshnessStrip rainfall={rainfall} lang={lang} />
      <div className="flex justify-start"><DataReceiptDrawer data={data} lang={lang} /></div>
      {/* Freshness banner */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#D7E9FF] bg-surface-blue p-4 text-xs text-ink-soft">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-info shrink-0" />
          <span>
            <strong>{power_summary.freshness.dataset_name}</strong> | {t.freshnessLatest} {power_summary.freshness.latest_observation_date || "N/A"} ({freshnessStatusWord})
          </span>
        </div>
        <span className="hidden rounded-full bg-soft px-2.5 py-1 text-[11px] font-semibold text-ink-soft md:inline">{t.freshnessLatency} {power_summary.freshness.typical_latency}</span>
      </div>

      {data.stress_watch ? <StressWatchBanner watch={data.stress_watch} lang={lang} /> : null}
      {data.signals ? <SignalTiles bundle={data.signals} lang={lang} /> : null}
      {data.rain_agreement ? <SourceAgreementBadge agreement={data.rain_agreement} lang={lang} /> : null}
      <DataClock data={data} lang={lang} />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Local rainfall observation */}
        <div className="flex flex-col justify-between rounded-2xl border border-line bg-white p-4 shadow-card">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-medium text-ink-soft">{t.localRainfall}</span>
            <CloudRain className="w-6 h-6 text-info" />
          </div>
          {hasLocalRainfall ? (
            <div>
              <span className="tnum text-3xl font-bold text-ink">{rainfall.amount_mm}</span>
              <span className="text-ink-muted ml-1">mm</span>
            </div>
          ) : (
            <div>
              <span className="rounded-full bg-amber-soft px-2.5 py-1 text-[11px] font-semibold text-amber-ink">{t.notVerified}</span>
            </div>
          )}
          <p className="tnum mt-2 text-xs text-ink-muted">
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
            <div className="mt-3 rounded-lg border border-line bg-soft p-3">
              <p className="text-xs font-semibold text-ink-soft">{t.regionalEstimateOnly}</p>
              <p className="tnum mt-1 text-xs leading-5 text-ink-soft">
                {power_summary.rain_last_72h_mm} {t.regionalEstimateBody.replace("{dates}", regionalPowerDates)}{" "}
                {power_summary.freshness.spatial_resolution} {t.regionalEstimateTail}
              </p>
            </div>
          )}
        </div>

        {/* Soil Wetness */}
        <div className="flex flex-col justify-between rounded-2xl border border-line bg-white p-4 shadow-card">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-medium text-ink-soft">{t.wetnessCard}</span>
            <Droplets className="w-6 h-6 text-info" />
          </div>
          <div>
            <span className="tnum text-3xl font-bold text-ink">{power_summary.latest_surface_wetness !== null ? Math.round(power_summary.latest_surface_wetness * 100) : "N/A"}</span>
            {power_summary.latest_surface_wetness !== null && <span className="text-ink-muted ml-1">%</span>}
          </div>
          <span className="mt-2 text-xs text-ink-muted">{t.wetnessNote}</span>
        </div>

        {/* Temperature */}
        <div className="flex flex-col justify-between rounded-2xl border border-line bg-white p-4 shadow-card">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-medium text-ink-soft">{t.temperatureCard}</span>
            <Thermometer className="w-6 h-6 text-info" />
          </div>
          <div>
            <span className="tnum text-3xl font-bold text-ink">{power_summary.latest_temp_c ?? "N/A"}</span>
            {power_summary.latest_temp_c !== null && <span className="text-ink-muted ml-1">°C</span>}
          </div>
          <span className="mt-2 text-xs text-ink-muted">{t.temperatureNote}</span>
        </div>

        {/* Slope & Terrain */}
        <div className="flex flex-col justify-between rounded-2xl border border-line bg-white p-4 shadow-card">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-medium text-ink-soft">{t.terrainCard}</span>
            <Mountain className="w-6 h-6 text-ink-soft" />
          </div>
          <div>
            <span className="tnum text-3xl font-bold text-ink">{elevation.slope_percent !== null ? `${elevation.slope_percent}%` : "N/A"}</span>
            <span className="mt-1 block text-xs font-semibold text-ink-soft">{elevation.terrain_category}</span>
          </div>
          <span className="mt-2 text-xs text-ink-muted">{t.terrainNote}</span>
        </div>
      </div>

      <p className="rounded-lg border border-amber bg-amber-soft p-3 text-xs leading-5 text-amber-ink">{t.screenBCaveat}</p>

      <FarmerLogbook lang={lang} rainfall={rainfall} latitude={data.latitude} longitude={data.longitude} />

      {/* Input Configuration Card */}
      <div className="space-y-6 rounded-2xl border border-line bg-white p-6 shadow-card">
        <h3 className="text-xl font-bold text-ink">{t.selectFertilizer}</h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Fertilizer Type */}
          <div>
            <label className="mb-2 block text-sm font-semibold text-ink-soft">
              {t.fertilizerType}
            </label>
            <select
              value={fertilizerType}
              onChange={(e) => setFertilizerType(e.target.value)}
              className="w-full rounded-full border border-line bg-white px-4 py-3 font-medium text-ink focus:border-action focus:ring-4 focus:ring-action/15"
            >
              <option value="Urea">{t.fertilizerUrea}</option>
              <option value="DAP">{t.fertilizerDap}</option>
              <option value="Compost/FYM">{t.fertilizerCompost}</option>
            </select>
          </div>

          {/* Crop Stage */}
          <div>
            <label className="mb-2 block text-sm font-semibold text-ink-soft">
              {t.cropStage}
            </label>
            <select
              value={cropStage}
              onChange={(e) => setCropStage(e.target.value)}
              className="w-full rounded-full border border-line bg-white px-4 py-3 font-medium text-ink focus:border-action focus:ring-4 focus:ring-action/15"
            >
              <option value="Basal / Planting">{t.stageBasal}</option>
              <option value="Vegetative / Tillering">{t.stageVegetative}</option>
              <option value="Flowering / Grain Filling">{t.stageFlowering}</option>
            </select>
          </div>

          {/* Soil Texture / Sand Slider */}
          <div>
            <label className="mb-2 block tnum text-sm font-semibold text-ink-soft">
              {t.soilTexture}: {sandLabel}
            </label>
            <input
              type="number"
              min="0"
              max="100"
              step="1"
              value={sandVal}
              onChange={(e) => { const raw = e.target.value; if (raw === "") { onSandOverrideChange(null); return; } const value = Number(raw); if (Number.isFinite(value) && value >= 0 && value <= 100) onSandOverrideChange(value); }}
              className="w-full rounded-full border border-line bg-white px-4 py-3 font-medium text-ink focus:border-action focus:ring-4 focus:ring-action/15"
            />
            <span className="mt-1 block text-xs text-ink-muted">
              {t.soilHelperPrefix} {soil_texture.sand_percent === null ? t.soilHelperUnavailable : `${soil_texture.texture_class} (${soil_texture.sand_percent}% sand)`}.
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row justify-between items-center gap-4 border-t border-divider pt-4">
          <button
            onClick={onRunAssessment}
            className="flex items-center gap-2 rounded-full border border-border-strong bg-white px-6 py-3 font-semibold text-brand-blue-deep transition hover:bg-soft active:scale-[0.98]"
          >
            <RefreshCw className="w-4 h-4" />
            {t.rerunAssessment}
          </button>

          <button
            onClick={onProceedToDecision}
            className="flex items-center gap-2 rounded-full bg-action px-8 py-4 font-bold text-lg text-white transition hover:bg-action-pressed active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t.nextDecision}
            <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
