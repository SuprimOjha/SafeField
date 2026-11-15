"use client";

import React from "react";
import type { FieldAssessmentResponse } from "@/types/safefield";
import { getDict, type Lang } from "@/i18n";
import {
  CloudRain,
  CheckCircle2,
  Droplets,
  HelpCircle,
  MapPinned,
  RefreshCw,
  Sun,
} from "lucide-react";

// Design assumptions, not crop-specific or locally calibrated thresholds.
// They are shown to the farmer verbatim in irrigationThreshold* strings.
const DRY_ROOT_THRESHOLD = 0.2; // m³/m³ volumetric
const ADEQUATE_ROOT_THRESHOLD = 0.3; // m³/m³ volumetric
const RAIN_EXPECTED_48H_MM = 10;

type IrrigationStatus = "irrigate" | "waitRain" | "monitor" | "adequate" | "unknown";

interface ScreenFIrrigationProps {
  hasField: boolean;
  onSelectField: () => void;
  data: FieldAssessmentResponse | null;
  loading: boolean;
  error: string | null;
  onRunAssessment: () => void;
  lang: Lang;
}

function usableValue(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export default function ScreenFIrrigation({
  hasField,
  onSelectField,
  data,
  loading,
  error,
  onRunAssessment,
  lang,
}: ScreenFIrrigationProps) {
  const t = getDict(lang);

  if (!hasField) {
    return (
      <section className="mx-auto w-full max-w-2xl rounded-2xl border border-[#C7E0FF] bg-brand-blue-soft p-6 shadow-card sm:p-8" aria-labelledby="irrigation-gate-title">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-brand-blue-deep shadow-card">
          <MapPinned className="h-6 w-6" aria-hidden="true" />
        </span>
        <h2 id="irrigation-gate-title" className="mt-3 text-2xl font-bold tracking-tight text-brand-blue-deep">{t.irrigationNeedsFieldTitle}</h2>
        <p className="mt-2 text-sm leading-6 text-ink-soft">{t.irrigationNeedsFieldBody}</p>
        <button
          type="button"
          onClick={onSelectField}
          className="mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-action px-5 text-sm font-bold text-white transition hover:bg-action-pressed active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 sm:w-auto"
        >
          <MapPinned className="h-4 w-4" aria-hidden="true" />
          {t.irrigationNeedsFieldCta}
        </button>
      </section>
    );
  }

  if (loading) {
    return (
      <div role="status" aria-live="polite" className="rounded-2xl border border-line bg-white p-12 text-center shadow-card space-y-4">
        <RefreshCw className="mx-auto h-10 w-10 animate-spin text-action" aria-hidden="true" />
        <h3 className="text-xl font-bold text-ink">{t.loadingAssessment}</h3>
        <p className="text-sm text-ink-soft">{t.loadingAssessmentBody}</p>
      </div>
    );
  }

  if (!data) {
    const notRun = !error;
    return (
      <div role={notRun ? "status" : "alert"} aria-live={notRun ? "polite" : "assertive"} className="rounded-2xl border border-amber bg-white p-8 text-center shadow-card space-y-4 sm:p-12">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-soft text-amber-ink">
          <RefreshCw className="h-6 w-6" aria-hidden="true" />
        </div>
        <h3 className="text-xl font-bold text-ink">{notRun ? t.irrigationNoAssessmentTitle : t.assessmentFailed}</h3>
        <p className="mx-auto max-w-2xl text-sm leading-6 text-ink-soft">
          {notRun ? t.irrigationNoAssessmentBody : (error || t.assessmentFailedBody)}
        </p>
        <button
          type="button"
          onClick={onRunAssessment}
          className="inline-flex items-center justify-center gap-2 rounded-full bg-action px-6 py-3 font-semibold text-white transition hover:bg-action-pressed active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          {notRun ? t.homeRunAssessment : t.retryAssessment}
        </button>
      </div>
    );
  }

  const signals = data.signals?.signals;
  const rootSignal = signals?.soil_moisture_root ?? null;
  const surfaceSignal = signals?.soil_moisture_surface ?? null;
  const root = rootSignal && rootSignal.status !== "unavailable" && rootSignal.status !== "not_installed"
    ? usableValue(rootSignal.value)
    : null;
  const surface = surfaceSignal && surfaceSignal.status !== "unavailable" && surfaceSignal.status !== "not_installed"
    ? usableValue(surfaceSignal.value)
    : null;
  const rain72 = usableValue(data.rain_impact?.rain_72h_mm ?? data.power_summary.rain_last_72h_mm);
  const forecast48 = usableValue(data.forecast.expected_rain_next_48h_mm);

  let status: IrrigationStatus;
  if (root === null) {
    status = "unknown";
  } else if (root < DRY_ROOT_THRESHOLD) {
    status = forecast48 !== null && forecast48 >= RAIN_EXPECTED_48H_MM ? "waitRain" : "irrigate";
  } else if (root <= ADEQUATE_ROOT_THRESHOLD) {
    status = "monitor";
  } else {
    status = "adequate";
  }

  const statusText: Record<IrrigationStatus, string> = {
    irrigate: t.irrigationStatusIrrigate,
    waitRain: t.irrigationStatusWaitRain,
    monitor: t.irrigationStatusMonitor,
    adequate: t.irrigationStatusAdequate,
    unknown: t.irrigationStatusUnknown,
  };
  const reasonText: Record<IrrigationStatus, string> = {
    irrigate: t.irrigationReasonDryNoRain,
    waitRain: t.irrigationReasonDryRainComing,
    monitor: t.irrigationReasonWatch,
    adequate: t.irrigationReasonAdequate,
    unknown: t.irrigationReasonNoSignal,
  };
  const StatusIcon = status === "irrigate"
    ? Sun
    : status === "waitRain"
      ? CloudRain
      : status === "monitor"
        ? Droplets
        : status === "adequate"
          ? CheckCircle2
          : HelpCircle;
  const statusTone = status === "adequate"
    ? "border-divider bg-surface-green text-growth-deep"
    : status === "waitRain"
      ? "border-[#C7E0FF] bg-brand-blue-soft text-brand-blue-deep"
      : status === "unknown"
        ? "border-line bg-soft text-ink-soft"
        : "border-amber bg-amber-soft text-amber-ink";

  const moisture = (value: number | null) =>
    value === null ? t.irrigationNoData : `${Math.round(value * 100)}%`;

  return (
    <div className="space-y-6">
      <header className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-blue-soft text-brand-blue-deep">
          <Droplets className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">{t.irrigationTitle}</h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-ink-soft">{t.irrigationSubtitle}</p>
        </div>
      </header>

      <section className={`rounded-2xl border p-5 shadow-card ${statusTone}`} aria-labelledby="irrigation-status-title">
        <div className="flex items-start gap-3">
          <StatusIcon className="mt-0.5 h-6 w-6 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <p id="irrigation-status-title" className="text-[11px] font-bold uppercase tracking-wide opacity-80">{t.irrigationStatusTitle}</p>
            <h2 className="mt-1 text-xl font-bold sm:text-2xl">{statusText[status]}</h2>
            <p className="mt-2 text-sm leading-6">{reasonText[status]}</p>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-line bg-white p-4 shadow-card">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-medium text-ink-soft">{t.irrigationRootMoisture}</span>
            <Droplets className="h-5 w-5 text-info" aria-hidden="true" />
          </div>
          <p className="tnum text-3xl font-bold text-ink">{moisture(root)}</p>
          {root !== null && <p className="tnum mt-1 text-xs text-ink-muted">{root.toFixed(2)} m³/m³</p>}
          {rootSignal?.provenance?.valid_date && (
            <p className="tnum mt-2 text-[11px] leading-5 text-ink-muted">
              {t.irrigationSource}: SMAP L4 · {t.irrigationValidDate} {rootSignal.provenance.valid_date}
            </p>
          )}
          {rootSignal?.quality_note && (
            <p className="mt-1 text-[11px] leading-5 text-amber-ink">{rootSignal.quality_note}</p>
          )}
        </div>

        <div className="rounded-2xl border border-line bg-white p-4 shadow-card">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-medium text-ink-soft">{t.irrigationSurfaceMoisture}</span>
            <Droplets className="h-5 w-5 text-info" aria-hidden="true" />
          </div>
          <p className="tnum text-3xl font-bold text-ink">{moisture(surface)}</p>
          {surface !== null && <p className="tnum mt-1 text-xs text-ink-muted">{surface.toFixed(2)} m³/m³</p>}
        </div>

        <div className="rounded-2xl border border-line bg-white p-4 shadow-card">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-medium text-ink-soft">{t.irrigationRecentRain}</span>
            <CloudRain className="h-5 w-5 text-info" aria-hidden="true" />
          </div>
          <p className="tnum text-3xl font-bold text-ink">{rain72 === null ? t.irrigationNoData : `${Math.round(rain72)} mm`}</p>
        </div>

        <div className="rounded-2xl border border-line bg-white p-4 shadow-card">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-medium text-ink-soft">{t.irrigationForecast48h}</span>
            <CloudRain className="h-5 w-5 text-info" aria-hidden="true" />
          </div>
          <p className="tnum text-3xl font-bold text-ink">
            {forecast48 === null ? t.irrigationNoForecast : `${Math.round(forecast48)} mm`}
          </p>
        </div>
      </div>

      <p className="rounded-lg border border-[#D7E9FF] bg-surface-blue p-3 text-xs leading-5 text-ink-soft">
        {t.irrigationSignalNote}
      </p>

      <section className="rounded-2xl border border-line bg-white p-5 shadow-card" aria-labelledby="irrigation-thresholds-title">
        <h3 id="irrigation-thresholds-title" className="text-lg font-bold text-ink">{t.irrigationThresholdsTitle}</h3>
        <ul className="mt-3 space-y-2 text-sm leading-6 text-ink-soft">
          <li className="rounded-lg bg-soft p-3">{t.irrigationThresholdDry.replace("{value}", DRY_ROOT_THRESHOLD.toFixed(2))}</li>
          <li className="rounded-lg bg-soft p-3">{t.irrigationThresholdAdequate.replace("{value}", ADEQUATE_ROOT_THRESHOLD.toFixed(2))}</li>
          <li className="rounded-lg bg-soft p-3">{t.irrigationThresholdRain.replace("{value}", String(RAIN_EXPECTED_48H_MM))}</li>
        </ul>
        <p className="mt-3 text-xs leading-5 text-ink-muted">{t.irrigationAssumptionNote}</p>
      </section>

      <p className="rounded-lg border border-amber bg-amber-soft p-3 text-xs leading-5 text-amber-ink">{t.irrigationNoAmount}</p>
      <p className="text-xs leading-5 text-ink-muted">{t.irrigationRecheck}</p>

      <div className="flex justify-start">
        <button
          type="button"
          onClick={onRunAssessment}
          className="inline-flex items-center gap-2 rounded-full border border-border-strong bg-white px-6 py-3 font-semibold text-brand-blue-deep transition hover:bg-soft active:scale-[0.98]"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          {t.rerunAssessment}
        </button>
      </div>
    </div>
  );
}
