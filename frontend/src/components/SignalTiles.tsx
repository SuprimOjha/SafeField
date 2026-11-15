"use client";

import React from "react";
import { Activity, CloudRain, Droplets, Leaf, Sun, Thermometer, Waves } from "lucide-react";
import type { Dictionary } from "@/i18n";
import { getDict, type Lang } from "@/i18n";
import type { SignalBundle, SignalName, SignalStatus, SignalValue, VsNormal } from "@/types/safefield";

const SIGNAL_META: Record<SignalName, { label: keyof Dictionary; icon: typeof CloudRain }> = {
  rain: { label: "signalRain", icon: CloudRain },
  soil_moisture_surface: { label: "signalSoilSurface", icon: Droplets },
  soil_moisture_root: { label: "signalSoilRoot", icon: Waves },
  heat_air: { label: "signalHeatAir", icon: Thermometer },
  heat_surface: { label: "signalHeatSurface", icon: Sun },
  ndvi: { label: "signalNdvi", icon: Leaf },
  evi: { label: "signalEvi", icon: Activity },
};

const ORDER: SignalName[] = [
  "rain",
  "soil_moisture_surface",
  "soil_moisture_root",
  "heat_air",
  "heat_surface",
  "ndvi",
  "evi",
];

function statusKey(status: SignalStatus): keyof Dictionary {
  switch (status) {
    case "available":
      return "signalStatusAvailable";
    case "partial":
      return "signalStatusPartial";
    case "stale":
      return "signalStatusStale";
    case "not_installed":
      return "signalStatusNotInstalled";
    default:
      return "signalStatusUnavailable";
  }
}

function statusClass(status: SignalStatus): string {
  if (status === "available") return "bg-success-soft text-success";
  if (status === "partial") return "bg-amber-soft text-amber-ink";
  if (status === "stale") return "bg-amber-soft text-amber-ink";
  return "bg-soft text-ink-soft";
}

function vsNormalKey(value: VsNormal): keyof Dictionary {
  switch (value) {
    case "much_below":
      return "vsMuchBelow";
    case "below":
      return "vsBelow";
    case "near_normal":
      return "vsNearNormal";
    case "above":
      return "vsAbove";
    case "much_above":
      return "vsMuchAbove";
    default:
      return "vsUnknown";
  }
}

function formatValue(signal: SignalValue): string {
  if (signal.value === null) return "—";
  if (signal.name === "soil_moisture_surface" || signal.name === "soil_moisture_root") {
    return signal.value.toFixed(3);
  }
  if (signal.name === "ndvi" || signal.name === "evi") return signal.value.toFixed(2);
  return String(signal.value);
}

function kindLabel(kind: string, t: Dictionary): string {
  switch (kind) {
    case "observation":
      return t.kindObservation;
    case "model":
      return t.kindModel;
    case "forecast":
      return t.kindForecast;
    case "fallback":
      return t.kindFallback;
    case "cached":
      return t.kindCached;
    case "farmer_input":
      return t.kindFarmerInput;
    case "assumption":
      return t.kindAssumption;
    default:
      return kind;
  }
}

function SignalTile({ signal, lang }: { signal: SignalValue; lang: Lang }) {
  const t = getDict(lang);
  const meta = SIGNAL_META[signal.name];
  const Icon = meta.icon;
  const hasValue = signal.value !== null && signal.status !== "unavailable" && signal.status !== "not_installed";
  const provenance = signal.provenance;

  return (
    <article className="flex flex-col justify-between rounded-2xl border border-line bg-white p-4 shadow-card">
      <div>
        <div className="mb-3 flex items-start justify-between gap-2">
          <span className="text-[12px] font-semibold leading-5 text-ink-soft">{t[meta.label]}</span>
          <Icon aria-hidden="true" className="h-5 w-5 shrink-0 text-info" />
        </div>
        {hasValue ? (
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="tnum text-3xl font-bold text-ink">{formatValue(signal)}</span>
            {signal.unit ? <span className="text-xs text-ink-muted">{signal.unit}</span> : null}
          </div>
        ) : (
          <p className="text-sm font-semibold text-ink-muted">{t.signalNoValue}</p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${statusClass(signal.status)}`}>
            {t[statusKey(signal.status)]}
          </span>
          {hasValue && signal.vs_normal !== "unknown" ? (
            <span className="rounded-full border border-divider bg-soft px-2 py-0.5 text-[11px] font-semibold text-ink-soft">
              {t[vsNormalKey(signal.vs_normal)]}
            </span>
          ) : null}
        </div>
        {!hasValue && signal.unavailable_reason ? (
          <p className="mt-2 text-xs leading-5 text-ink-muted">{signal.unavailable_reason}</p>
        ) : null}
        {hasValue && signal.baseline !== null ? (
          <p className="tnum mt-2 text-xs text-ink-muted">
            {t.signalBaseline}: {signal.baseline} · {t.signalBaselineYears.replace("{years}", String(signal.baseline_years))}
          </p>
        ) : null}
      </div>
      {provenance ? (
        <details className="mt-3 border-t border-divider pt-2">
          <summary className="inline-flex min-h-9 cursor-pointer select-none items-center text-xs font-semibold text-brand-blue-deep underline decoration-dotted underline-offset-4">
            {t.signalDetails}
          </summary>
          <dl className="mt-2 space-y-1 text-xs leading-5 text-ink-soft">
            <div>
              <dt className="inline font-semibold">{t.signalSourceLabel}: </dt>
              <dd className="inline">{provenance.source_name}</dd>
            </div>
            <div>
              <dt className="inline font-semibold">{t.signalKindLabel}: </dt>
              <dd className="inline">
                {kindLabel(provenance.kind, t)} · {provenance.is_nasa ? t.signalNasaYes : t.signalNasaNo}
              </dd>
            </div>
            <div>
              <dt className="inline font-semibold">{t.signalValidDate}: </dt>
              <dd className="tnum inline">{provenance.valid_date ?? "—"}</dd>
            </div>
            <div>
              <dt className="inline font-semibold">{t.signalResolution}: </dt>
              <dd className="inline">{provenance.spatial_resolution}</dd>
            </div>
            <div>
              <dt className="inline font-semibold">{t.signalLatency}: </dt>
              <dd className="inline">{provenance.latency_note}</dd>
            </div>
            <div>
              <dt className="inline font-semibold">{t.signalCaveatLabel}: </dt>
              <dd className="inline">{provenance.caveat}</dd>
            </div>
            {signal.quality_note ? (
              <div>
                <dt className="inline font-semibold">{t.signalQualityNote}: </dt>
                <dd className="inline">{signal.quality_note}</dd>
              </div>
            ) : null}
          </dl>
        </details>
      ) : null}
    </article>
  );
}

export default function SignalTiles({ bundle, lang }: { bundle: SignalBundle; lang: Lang }) {
  const t = getDict(lang);
  const signals = ORDER.map((name) => bundle.signals[name]).filter((signal): signal is SignalValue => Boolean(signal));
  return (
    <section aria-labelledby="signal-tiles-title" className="space-y-3">
      <div>
        <h3 id="signal-tiles-title" className="text-xl font-bold text-ink">{t.signalsTitle}</h3>
        <p className="mt-1 text-sm leading-6 text-ink-soft">{t.signalsIntro}</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {signals.map((signal) => (
          <SignalTile key={signal.name} signal={signal} lang={lang} />
        ))}
      </div>
      <p className="rounded-lg border border-line bg-soft p-3 text-xs leading-5 text-ink-soft">{t.signalsAreaNote}</p>
    </section>
  );
}
