"use client";

import React from "react";
import {
  CloudRain,
  CloudSun,
  Droplets,
  Gauge,
  Leaf,
  MapPin,
  MessageCircleQuestion,
  Mountain,
  RefreshCw,
  ShieldCheck,
  Sprout,
  Thermometer,
  Wind,
  ArrowRight,
} from "lucide-react";
import type {
  FactorState,
  FieldAssessmentResponse,
  SignalName,
  SignalValue,
  VsNormal,
} from "@/types/safefield";
import type { Dictionary } from "@/i18n";

type Dict = Dictionary;

const SIGNAL_ORDER: SignalName[] = [
  "rain",
  "soil_moisture_surface",
  "soil_moisture_root",
  "heat_air",
  "heat_surface",
  "ndvi",
  "evi",
];

function numberOrDash(value: number | null | undefined, digits = 0): string {
  return Number.isFinite(value) ? (value as number).toFixed(digits) : "—";
}

function vsLabel(vs: VsNormal, t: Dict): string {
  switch (vs) {
    case "much_below":
      return t.vsMuchBelow;
    case "below":
      return t.vsBelow;
    case "near_normal":
      return t.vsNearNormal;
    case "above":
      return t.vsAbove;
    case "much_above":
      return t.vsMuchAbove;
    default:
      return t.vsUnknown;
  }
}

function weatherKey(code: number | null | undefined): keyof Dict {
  if (code === null || code === undefined) return "weatherUnknown";
  if (code === 0) return "weatherClear";
  if (code === 1) return "weatherMainlyClear";
  if (code === 2) return "weatherPartlyCloudy";
  if (code === 3) return "weatherOvercast";
  if (code === 45 || code === 48) return "weatherFog";
  if ([51, 53, 55].includes(code)) return "weatherDrizzle";
  if ([56, 57, 66, 67].includes(code)) return "weatherFreezingRain";
  if ([61, 63, 65].includes(code)) return "weatherRain";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "weatherSnow";
  if ([80, 81, 82].includes(code)) return "weatherShowers";
  if ([95, 96, 99].includes(code)) return "weatherThunderstorm";
  return "weatherUnknown";
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-line bg-white p-5 shadow-card ${className}`}>
      {children}
    </section>
  );
}

function SourceLine({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-[11px] leading-4 text-ink-muted">{children}</p>;
}

export function WeatherCard({ data, loading, t }: { data: FieldAssessmentResponse | null; loading: boolean; t: Dict }) {
  const day = data?.forecast.forecast_days?.[0] ?? null;
  const mean = data?.power_summary.latest_temp_c ?? null;
  const meanDate = data?.power_summary.freshness.latest_observation_date ?? null;
  const weatherLabel = day?.weather_code !== undefined && day?.weather_code !== null
    ? t[weatherKey(day.weather_code)]
    : t.weatherUnknown;

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-bold uppercase tracking-[.14em] text-ink-muted">{t.homeWeatherTitle}</p>
        <CloudSun className="h-5 w-5 shrink-0 text-info" aria-hidden="true" />
      </div>

      <div className="mt-3 flex items-center gap-4">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-brand-blue-soft text-brand-blue-deep">
          <CloudSun className="h-9 w-9" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink-soft">{weatherLabel}</p>
          <div className="tnum mt-0.5 flex items-end gap-1">
            <span className="text-4xl font-bold tracking-tight text-ink">{numberOrDash(mean, 1)}</span>
            <span className="pb-1 text-sm font-semibold text-ink-muted">°C</span>
          </div>
          <p className="mt-0.5 truncate text-[11px] text-ink-muted">
            {t.homeWeatherMean}{meanDate ? ` · ${meanDate}` : ""}
          </p>
        </div>
      </div>

      {loading ? <p className="mt-3 text-xs font-semibold text-ink-muted">{t.homeRunningAssessment}</p> : null}
      {!data && !loading ? (
        <p className="mt-3 rounded-lg border border-dashed border-border-strong bg-soft px-3 py-2 text-xs leading-5 text-ink-soft">
          {t.homeWeatherNoData}
        </p>
      ) : null}

      <div className="mt-4 space-y-2">
        <div className="flex items-center justify-between gap-3 rounded-xl bg-soft px-3 py-2.5">
          <span className="flex items-center gap-2 text-xs font-semibold text-ink-soft"><Thermometer className="h-4 w-4 text-info" aria-hidden="true" />{t.homeWeatherTodayMaxMin}</span>
          <span className="tnum text-xs font-bold text-ink">
            {day?.temperature_2m_max_c !== null && day?.temperature_2m_max_c !== undefined ? `${numberOrDash(day.temperature_2m_max_c, 1)}°` : "—"}
            {" / "}
            {day?.temperature_2m_min_c !== null && day?.temperature_2m_min_c !== undefined ? `${numberOrDash(day.temperature_2m_min_c, 1)}°` : "—"}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-xl bg-soft px-3 py-2.5">
          <span className="flex items-center gap-2 text-xs font-semibold text-ink-soft"><Wind className="h-4 w-4 text-info" aria-hidden="true" />{t.homeWeatherWind}</span>
          <span className="tnum text-xs font-bold text-ink">{day?.wind_speed_10m_max_kmh !== null && day?.wind_speed_10m_max_kmh !== undefined ? `${numberOrDash(day.wind_speed_10m_max_kmh, 0)} km/h` : "—"}</span>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-xl bg-soft px-3 py-2.5">
          <span className="flex items-center gap-2 text-xs font-semibold text-ink-soft"><CloudRain className="h-4 w-4 text-info" aria-hidden="true" />{t.homeWeatherRainChance}</span>
          <span className="tnum text-xs font-bold text-ink">
            {day?.precipitation_probability_max !== null && day?.precipitation_probability_max !== undefined ? `${numberOrDash(day.precipitation_probability_max, 0)}%` : "—"}
          </span>
        </div>
      </div>

      <SourceLine>{t.homeWeatherSource}</SourceLine>
    </Card>
  );
}

export function VegetationCard({ data, t }: { data: FieldAssessmentResponse | null; t: Dict }) {
  const signal: SignalValue | undefined = data?.signals?.signals.ndvi ?? data?.signals?.signals.evi;
  const available = signal?.status === "available" && signal.value !== null;
  const statusLabel = signal?.status === "not_installed"
    ? t.signalStatusNotInstalled
    : signal?.status === "stale"
      ? t.signalStatusStale
      : signal?.status === "partial"
        ? t.signalStatusPartial
        : signal?.status === "available"
          ? t.signalStatusAvailable
          : t.signalStatusUnavailable;
  const notInstalledNote = signal?.status === "not_installed"
    ? t.homeVegetationNotInstalled
    : signal?.unavailable_reason;

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-bold uppercase tracking-[.14em] text-ink-muted">{t.homeVegetationTitle}</p>
        <Leaf className="h-5 w-5 shrink-0 text-growth-deep" aria-hidden="true" />
      </div>
      {available && (
        <div className="mt-3 flex items-end gap-2">
          <span className="tnum text-4xl font-bold tracking-tight text-ink">{numberOrDash(signal?.value, 2)}</span>
          <span className="mb-1.5 text-xs font-semibold text-ink-muted">{signal?.unit || ""}</span>
        </div>
      )}
      <span className={`${available ? "mt-2" : "mt-3"} inline-flex rounded-full bg-soft px-2.5 py-1 text-[11px] font-bold text-ink-soft`}>{statusLabel}</span>
      {available ? <p className="mt-2 text-xs font-semibold text-ink-soft">{vsLabel(signal?.vs_normal ?? "unknown", t)}</p> : null}
      {!available && notInstalledNote ? <p className="mt-2 text-xs leading-5 text-ink-muted">{notInstalledNote}</p> : null}
      <SourceLine>{t.homeVegetationNote}</SourceLine>
    </Card>
  );
}

export function SoilMoistureCard({ data, t }: { data: FieldAssessmentResponse | null; t: Dict }) {
  const surface = data?.power_summary.latest_surface_wetness ?? null;
  const root = data?.power_summary.latest_root_wetness ?? null;
  const row = (label: string, value: number | null) => {
    const percent = value === null ? null : Math.min(100, Math.max(0, Math.round(value * 100)));
    return (
      <div>
        <div className="flex items-center justify-between gap-2 text-xs font-semibold text-ink-soft">
          <span>{label}</span>
          <span className="tnum text-ink">{percent === null ? "—" : `${percent}%`}</span>
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-soft" role="presentation">
          <div className="h-full rounded-full bg-gradient-brand" style={{ width: `${percent ?? 0}%` }} />
        </div>
      </div>
    );
  };

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-bold uppercase tracking-[.14em] text-ink-muted">{t.homeSoilTitle}</p>
        <Droplets className="h-5 w-5 shrink-0 text-info" aria-hidden="true" />
      </div>
      <div className="mt-4 space-y-3">
        {row(t.homeSoilSurface, surface)}
        {row(t.homeSoilRoot, root)}
      </div>
      <SourceLine>{t.homeSoilNote}</SourceLine>
    </Card>
  );
}

export function FieldSummaryCard({
  data,
  loading,
  fieldArea,
  locationName,
  onRunAssessment,
  onOpenField,
  t,
}: {
  data: FieldAssessmentResponse | null;
  loading: boolean;
  fieldArea: number | null;
  locationName: string;
  onRunAssessment: () => void;
  onOpenField: () => void;
  t: Dict;
}) {
  const soilRaw = data?.soil_texture.texture_class?.trim() ?? "";
  const soil = soilRaw && !/^(unavailable|n\/a|unknown)$/i.test(soilRaw) ? soilRaw : null;
  const slope = data?.elevation.slope_percent ?? null;
  const elevation = data?.elevation.elevation_meters ?? null;
  const area = fieldArea === null ? null : `${fieldArea.toFixed(2)} ha`;
  const soilLabel = soil ?? t.homeUnavailable;

  return (
    <Card className="flex flex-col">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[.14em] text-ink-muted">{t.homeFieldTitle}</p>
          <p className="mt-1 flex items-center gap-1.5 text-sm font-bold text-ink">
            <MapPin className="h-4 w-4 shrink-0 text-action" aria-hidden="true" />
            <span className="truncate">{locationName}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!data ? (
            <button
              type="button"
              onClick={onRunAssessment}
              disabled={loading}
              className="inline-flex min-h-11 items-center gap-2 rounded-full bg-action px-4 text-sm font-bold text-white transition hover:bg-action-pressed active:scale-[0.98] disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
              {loading ? t.homeRunningAssessment : t.homeRunAssessment}
            </button>
          ) : (
            <button
              type="button"
              onClick={onOpenField}
              className="inline-flex min-h-11 items-center gap-2 rounded-full bg-action px-4 text-sm font-bold text-white transition hover:bg-action-pressed active:scale-[0.98]"
            >
              {t.homeOpenReport}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
          {data ? (
            <button
              type="button"
              onClick={onRunAssessment}
              disabled={loading}
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-white px-4 text-sm font-semibold text-ink-soft transition hover:bg-soft active:scale-[0.98] disabled:opacity-60"
              aria-label={t.rerunAssessment}
              title={t.rerunAssessment}
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-xl bg-soft px-3 py-3">
          <dt className="text-[11px] font-semibold text-ink-muted">{t.homeFieldArea}</dt>
          <dd className="tnum mt-1 text-sm font-bold text-ink">{area ?? t.homeFieldNoArea}</dd>
        </div>
        <div className="rounded-xl bg-soft px-3 py-3">
          <dt className="text-[11px] font-semibold text-ink-muted">{t.homeFieldSlope}</dt>
          <dd className="tnum mt-1 text-sm font-bold text-ink">{slope === null ? "—" : `${numberOrDash(slope, 1)}%`}</dd>
        </div>
        <div className="rounded-xl bg-soft px-3 py-3">
          <dt className="text-[11px] font-semibold text-ink-muted">{t.homeFieldElevation}</dt>
          <dd className="tnum mt-1 text-sm font-bold text-ink">{elevation === null ? "—" : `${numberOrDash(elevation, 0)} m`}</dd>
        </div>
        <div className="rounded-xl bg-soft px-3 py-3">
          <dt className="text-[11px] font-semibold text-ink-muted">{t.homeFieldSoil}</dt>
          <dd className="mt-1 truncate text-sm font-bold text-ink" title={soilLabel}>{soilLabel}</dd>
        </div>
      </dl>

      <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 pt-3 text-[11px] text-ink-muted">
        <span className="inline-flex items-center gap-1.5"><Mountain className="h-3.5 w-3.5" aria-hidden="true" />{data ? t.terrainNote : t.homeFieldNoAssessment}</span>
        <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />{t.homePrivacyNote}</span>
      </div>
    </Card>
  );
}

export function SignalCoverageCard({ data, t }: { data: FieldAssessmentResponse | null; t: Dict }) {
  const bundle = data?.signals;
  const values = SIGNAL_ORDER.map((name) => bundle?.signals[name]).filter((value): value is SignalValue => Boolean(value));
  const available = values.filter((value) => value.status === "available").length;
  const partial = values.filter((value) => value.status === "partial").length;
  const missing = values.filter((value) => value.status === "not_installed" || value.status === "unavailable" || value.status === "stale").length;
  const total = SIGNAL_ORDER.length;
  const percent = Math.round((available / total) * 100);
  const radius = 54;
  const circumference = 2 * Math.PI * radius;

  return (
    <Card className="flex flex-col">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-bold uppercase tracking-[.14em] text-ink-muted">{t.homeSignalsTitle}</p>
        <Gauge className="h-5 w-5 shrink-0 text-brand-blue-deep" aria-hidden="true" />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-4">
        <div className="relative h-32 w-32 shrink-0">
          <svg viewBox="0 0 140 140" className="h-full w-full" role="img" aria-label={`${percent}%`}>
            <defs>
              <linearGradient id="signal-coverage-gradient" x1="0" y1="1" x2="1" y2="0">
                <stop offset="0%" stopColor="#16c9e8" />
                <stop offset="100%" stopColor="#079447" />
              </linearGradient>
            </defs>
            <circle cx="70" cy="70" r={radius} fill="none" stroke="#eaf0f6" strokeWidth="13" />
            <circle
              cx="70"
              cy="70"
              r={radius}
              fill="none"
              stroke="url(#signal-coverage-gradient)"
              strokeWidth="13"
              strokeLinecap="round"
              strokeDasharray={`${(circumference * percent) / 100} ${circumference}`}
              transform="rotate(-90 70 70)"
            />
            <text x="70" y="68" textAnchor="middle" fontSize="26" fontWeight="700" fill="#142033">{percent}%</text>
            <text x="70" y="87" textAnchor="middle" fontSize="10" fill="#718096">{t.homeSignalsAvailableCount}</text>
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-6 text-ink-soft">
            {data ? t.homeSignalsBody.replace("{available}", String(available)).replace("{total}", String(total)) : t.homeSignalsNone}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className="inline-flex rounded-full bg-success-soft px-2.5 py-1 text-[11px] font-bold text-success">{t.signalStatusAvailable}: {available}</span>
            <span className="inline-flex rounded-full bg-amber-soft px-2.5 py-1 text-[11px] font-bold text-amber-ink">{t.signalStatusPartial}: {partial}</span>
            <span className="inline-flex rounded-full bg-soft px-2.5 py-1 text-[11px] font-bold text-ink-soft">{t.homeSignalsMissing}: {missing}</span>
          </div>
        </div>
      </div>
      <SourceLine>{t.homeSignalsNote}</SourceLine>
    </Card>
  );
}

export function RainImpactCard({ data, t }: { data: FieldAssessmentResponse | null; t: Dict }) {
  const impact = data?.rain_impact;
  const classification = impact?.classification ?? "unknown";
  const label = classification === "heavy_recent"
    ? t.rainImpactHeavyRecent
    : classification === "heavy_forecast"
      ? t.rainImpactHeavyForecast
      : classification === "none"
        ? t.rainImpactNone
        : t.rainImpactUnknown;
  const tone = classification === "heavy_recent" || classification === "heavy_forecast"
    ? "bg-info-soft text-info"
    : classification === "none"
      ? "bg-success-soft text-success"
      : "bg-soft text-ink-soft";

  const stat = (labelText: string, value: number | null | undefined) => (
    <div className="rounded-xl bg-soft px-3 py-2.5">
      <p className="text-[11px] font-semibold text-ink-muted">{labelText}</p>
      <p className="tnum mt-0.5 text-sm font-bold text-ink">{Number.isFinite(value) ? `${numberOrDash(value, 1)} mm` : "—"}</p>
    </div>
  );

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-bold uppercase tracking-[.14em] text-ink-muted">{t.homeRainTitle}</p>
        <CloudRain className="h-5 w-5 shrink-0 text-info" aria-hidden="true" />
      </div>
      <span className={`mt-3 inline-flex rounded-full px-3 py-1.5 text-xs font-bold ${tone}`}>{label}</span>
      <div className="mt-3 grid grid-cols-3 gap-1.5">
        {stat(t.homeRain24h, impact?.rain_24h_mm)}
        {stat(t.homeRain72h, impact?.rain_72h_mm)}
        {stat(t.homeRainNext48h, impact?.forecast_48h_mm)}
      </div>
      <SourceLine>{t.homeRainNote}</SourceLine>
    </Card>
  );
}

const FACTOR_STATE_TONE: Record<FactorState, string> = {
  watch: "bg-amber",
  no_watch: "bg-success",
  unknown: "bg-disabled",
};

export function StressCard({ data, onOpenField, t }: { data: FieldAssessmentResponse | null; onOpenField: () => void; t: Dict }) {
  const watch = data?.stress_watch;
  const overall = watch?.overall ?? "unknown";
  const overallLabel = overall === "watch" ? t.stressFactorWatch : overall === "no_watch" ? t.stressNoWatch : t.stressUnknown;
  const factors = watch?.factors ?? [];

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-bold uppercase tracking-[.14em] text-ink-muted">{t.stressWatch}</p>
        <ShieldCheck className="h-5 w-5 shrink-0 text-brand-blue-deep" aria-hidden="true" />
      </div>
      <p className="mt-2 text-lg font-bold text-ink">{overallLabel}</p>
      <ul className="mt-3 space-y-2">
        {factors.length ? factors.map((factor) => {
          const name = factor.factor === "water"
            ? t.stressFactorWater
            : factor.factor === "heat"
              ? t.stressFactorHeat
              : factor.factor === "vegetation"
                ? t.stressFactorVegetation
                : t.stressFactorRain;
          const state = factor.state === "watch" ? t.stressFactorWatch : factor.state === "no_watch" ? t.stressFactorNoWatch : t.stressFactorUnknown;
          return (
            <li key={factor.factor} className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2">
              <span className="flex items-center gap-2 text-xs font-semibold text-ink-soft">
                <span className={`h-2 w-2 rounded-full ${FACTOR_STATE_TONE[factor.state]}`} aria-hidden="true" />
                {name}
              </span>
              <span className="text-[11px] font-bold text-ink-muted">{state}</span>
            </li>
          );
        }) : <li className="rounded-xl border border-dashed border-border-strong px-3 py-2 text-xs text-ink-muted">{t.homeFieldNoAssessment}</li>}
      </ul>
      <button
        type="button"
        onClick={onOpenField}
        className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-brand-blue-deep underline decoration-dotted underline-offset-4"
      >
        {t.homeOpenReport} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </Card>
  );
}

export function AskCard({ t }: { t: Dict }) {
  const open = () => window.dispatchEvent(new Event("safefield-open-ask"));
  const questions = [t.homeAskQ1, t.homeAskQ2, t.homeAskQ3];

  return (
    <Card className="border-[#D7E9FF] bg-gradient-to-br from-brand-blue-pale via-white to-growth-pale">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-bold uppercase tracking-[.14em] text-brand-blue-deep">{t.homeAskTitle}</p>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-brand-blue-deep shadow-card">
          <MessageCircleQuestion className="h-5 w-5" aria-hidden="true" />
        </span>
      </div>
      <p className="mt-2 text-sm leading-6 text-ink-soft">{t.homeAskBody}</p>
      <ul className="mt-3 space-y-2">
        {questions.map((question) => (
          <li key={question}>
            <button
              type="button"
              onClick={open}
              className="flex w-full items-center justify-between gap-2 rounded-xl bg-white/85 px-3 py-2.5 text-left text-xs font-semibold text-ink-soft transition hover:bg-white active:scale-[0.99]"
            >
              <span>{question}</span>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-ink-muted" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={open}
        className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-action px-4 text-sm font-bold text-white transition hover:bg-action-pressed active:scale-[0.98]"
      >
        <Sprout className="h-4 w-4" aria-hidden="true" />
        {t.homeAskOpen}
      </button>
    </Card>
  );
}
