"use client";

import React, { useEffect, useState } from "react";
import { Clock3 } from "lucide-react";
import type { Dictionary } from "@/i18n";
import { getDict, type Lang } from "@/i18n";
import type { FieldAssessmentResponse, SignalKind } from "@/types/safefield";

type RowStatus = "live" | "available" | "cached" | "unavailable";

interface ClockRow {
  id: string;
  label: keyof Dictionary;
  source: string;
  valid: string;
  checked: string;
  kind: SignalKind | null;
  isNasa: boolean | null;
  status: RowStatus;
}

function kindLabel(kind: SignalKind | null, t: Dictionary): string {
  if (kind === null) return "—";
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
    default:
      return t.kindAssumption;
  }
}

function statusFromBadge(status: string): RowStatus {
  if (status === "LIVE") return "live";
  if (status === "CACHED_FALLBACK") return "cached";
  return "unavailable";
}

function statusLabel(status: RowStatus, t: Dictionary): string {
  if (status === "live") return t.freshnessStatusLive;
  if (status === "available") return t.signalStatusAvailable;
  if (status === "cached") return t.freshnessStatusCached;
  return t.freshnessStatusUnavailable;
}

function isNasaSource(sourceName: string): boolean {
  const lower = sourceName.toLowerCase().replace(/non[- ]?nasa/g, "");
  return lower.includes("nasa") || lower.includes("imerg");
}

function buildRows(data: FieldAssessmentResponse, unavailable: string): ClockRow[] {
  const rows: ClockRow[] = [];
  const rain = data.rainfall_observation;
  const provenance = rain.provenance;
  rows.push({
    id: "rain",
    label: "dataClockRain",
    source: provenance?.source_name ?? unavailable,
    valid: provenance
      ? `${provenance.observed_start_utc.slice(0, 10)} → ${provenance.observed_end_utc.slice(0, 10)}`
      : "—",
    checked: provenance?.fetched_at_utc ?? "—",
    kind: provenance?.kind ?? null,
    isNasa: provenance ? isNasaSource(provenance.source_name) : null,
    status: rain.status === "AVAILABLE" ? "available" : "unavailable",
  });

  const sources: { id: string; label: keyof Dictionary; freshness: FieldAssessmentResponse["power_summary"]["freshness"]; kind: SignalKind }[] = [
    { id: "power", label: "dataClockPower", freshness: data.power_summary.freshness, kind: "model" },
    { id: "forecast", label: "dataClockForecast", freshness: data.forecast.freshness, kind: "forecast" },
    { id: "elevation", label: "dataClockElevation", freshness: data.elevation.freshness, kind: "model" },
    { id: "soil", label: "dataClockSoil", freshness: data.soil_texture.freshness, kind: "model" },
  ];
  for (const source of sources) {
    const status = statusFromBadge(source.freshness.status);
    rows.push({
      id: source.id,
      label: source.label,
      source: source.freshness.source_org,
      valid: source.freshness.latest_observation_date ?? "—",
      checked: source.freshness.fetched_at_utc,
      kind: status === "cached" ? "cached" : source.kind,
      isNasa: source.freshness.is_nasa,
      status,
    });
  }

  return rows;
}

function ageHours(checked: string, nowMs: number | null): number | null {
  if (nowMs === null) return null;
  const parsed = Date.parse(checked);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.round((nowMs - parsed) / 3_600_000));
}

export default function DataClock({ data, lang }: { data: FieldAssessmentResponse; lang: Lang }) {
  const t = getDict(lang);
  const [nowMs, setNowMs] = useState<number | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setNowMs(Date.now()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const rows = buildRows(data, t.dataClockUnavailable);

  return (
    <section aria-labelledby="data-clock-title" className="rounded-2xl border border-line bg-white p-4 shadow-card">
      <div className="flex items-start gap-3">
        <Clock3 aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-info" />
        <div className="min-w-0 flex-1">
          <h3 id="data-clock-title" className="text-base font-bold text-ink">{t.dataClockTitle}</h3>
          <p className="mt-1 text-xs leading-5 text-ink-soft">{t.dataClockIntro}</p>
          <ul className="mt-3 space-y-2 sm:hidden">
            {rows.map((row) => {
              const hours = ageHours(row.checked, nowMs);
              return (
                <li key={row.id} className="rounded-xl border border-divider p-3 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-bold text-ink">{t[row.label]}</span>
                    <span className="rounded-full bg-soft px-2 py-0.5 text-[10px] font-semibold text-ink-soft">
                      {statusLabel(row.status, t)}
                    </span>
                  </div>
                  <p className="mt-1 break-words text-ink-muted">{row.source}</p>
                  <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-ink-soft">
                    <dt className="text-ink-muted">{t.dataClockValid}</dt>
                    <dd className="tnum text-right">{row.valid}</dd>
                    <dt className="text-ink-muted">{t.dataClockChecked}</dt>
                    <dd className="tnum break-all text-right">{row.checked}</dd>
                    <dt className="text-ink-muted">{t.dataClockKind}</dt>
                    <dd className="text-right">
                      {kindLabel(row.kind, t)}
                      {row.isNasa !== null ? ` · ${row.isNasa ? t.signalNasaYes : t.signalNasaNo}` : ""}
                    </dd>
                    <dt className="text-ink-muted">{t.dataClockAge}</dt>
                    <dd className="tnum text-right">{hours === null ? "—" : t.dataClockHoursAgo.replace("{hours}", String(hours))}</dd>
                  </dl>
                </li>
              );
            })}
          </ul>
          <div className="mt-3 hidden overflow-x-auto sm:block">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-divider text-ink-muted">
                  <th scope="col" className="py-2 pr-3 font-semibold">{t.dataClockSource}</th>
                  <th scope="col" className="py-2 pr-3 font-semibold">{t.dataClockValid}</th>
                  <th scope="col" className="py-2 pr-3 font-semibold">{t.dataClockChecked}</th>
                  <th scope="col" className="py-2 pr-3 font-semibold">{t.dataClockKind}</th>
                  <th scope="col" className="py-2 font-semibold">{t.dataClockAge}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const hours = ageHours(row.checked, nowMs);
                  return (
                    <tr key={row.id} className="border-b border-divider align-top last:border-0">
                      <th scope="row" className="py-2 pr-3 font-semibold text-ink">
                        {t[row.label]}
                        <span className="mt-0.5 block font-normal text-ink-muted">{row.source}</span>
                        <span className="mt-0.5 inline-block rounded-full bg-soft px-2 py-0.5 text-[10px] font-semibold text-ink-soft">
                          {statusLabel(row.status, t)}
                        </span>
                      </th>
                      <td className="tnum py-2 pr-3 text-ink-soft">{row.valid}</td>
                      <td className="tnum py-2 pr-3 text-ink-soft">{row.checked}</td>
                      <td className="py-2 pr-3 text-ink-soft">
                        {kindLabel(row.kind, t)}
                        {row.isNasa !== null ? <span className="mt-0.5 block text-ink-muted">{row.isNasa ? t.signalNasaYes : t.signalNasaNo}</span> : null}
                      </td>
                      <td className="tnum py-2 text-ink-soft">
                        {hours === null ? "—" : t.dataClockHoursAgo.replace("{hours}", String(hours))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs leading-5 text-ink-muted">{t.dataClockAgeNote}</p>
        </div>
      </div>
    </section>
  );
}
