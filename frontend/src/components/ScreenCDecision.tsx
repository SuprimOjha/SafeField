"use client";

import React, { useState } from "react";
import { FieldAssessmentResponse } from "@/types/safefield";
import FarmerContentPanel from "@/components/FarmerContentPanel";
import DecisionCard from "@/components/DecisionCard";
import FreshnessStrip from "@/components/FreshnessStrip";
import DataReceiptDrawer from "@/components/DataReceiptDrawer";
import { getDict, type Lang } from "@/i18n";
import {
  ChevronDown,
  ChevronUp,
  CloudRain,
  ShieldCheck,
  Info,
  ArrowRight,
} from "lucide-react";

interface ScreenCDecisionProps {
  data: FieldAssessmentResponse | null;
  onProceedToTrends: () => void;
  lang: Lang;
}

export default function ScreenCDecision({
  data,
  onProceedToTrends,
  lang,
}: ScreenCDecisionProps) {
  const [whyOpen, setWhyOpen] = useState(true);
  const t = getDict(lang);

  if (!data) {
    return (
      <div className="rounded-xl border border-line bg-white p-8 text-center text-ink-soft shadow-float">
        {t.selectFirst}
      </div>
    );
  }

  const { decision, forecast } = data;



  return (
    <div className="space-y-6">
      <DecisionCard decision={decision} lang={lang} />
      <FreshnessStrip rainfall={data.rainfall_observation} lang={lang} />
      <div className="flex justify-start"><DataReceiptDrawer data={data} lang={lang} /></div>


      {/* 5-Day Non-NASA Rain Outlook Strip */}
      <div className="rounded-xl border border-line bg-white p-6 shadow-float">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
          <div className="flex items-center gap-2">
            <CloudRain className="w-5 h-5 text-info" />
            <h3 className="text-lg font-bold text-ink">{t.rainOutlook}</h3>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-info/30 bg-info-soft px-3 py-1 text-xs font-semibold text-info">
            <Info className="w-3.5 h-3.5" />
            {t.nonNasaForecast}
          </span>
        </div>

        {forecast.forecast_days.length > 0 ? (
          <>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-soft">
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${forecast.freshness.status === "LIVE" ? "bg-action-soft text-forest" : "bg-amber-soft text-amber-ink"}`}>
                {forecast.freshness.status === "LIVE" ? t.liveForecast : t.cachedForecast}
              </span>
              <span className="tnum">{t.fetchedAt} {new Date(forecast.freshness.fetched_at_utc).toLocaleString()}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              {forecast.forecast_days.map((day) => {
                const isWet = day.precipitation_sum_mm !== null && day.precipitation_sum_mm >= 5.0;
                return (
                  <div
                    key={day.date}
                    className={`rounded-md border p-3.5 ${isWet ? "border-info/30 bg-info-soft" : "border-line bg-soft"}`}
                  >
                    <div className="tnum text-[11px] font-medium text-ink-soft">{day.date}</div>
                    <div className={`tnum mt-1 text-xl font-bold ${isWet ? "text-info" : "text-ink"}`}>
                      {day.precipitation_sum_mm ?? "N/A"} <span className="text-xs font-normal">{day.precipitation_sum_mm === null ? "" : t.mmRain}</span>
                    </div>
                    <div className="tnum mt-1 text-xs text-ink-soft">
                      {day.precipitation_probability_max !== null ? `${day.precipitation_probability_max}${t.rainChance}` : t.rainChanceUnavailable}
                    </div>
                    <div className="tnum mt-2 space-y-1 border-t border-divider pt-2 text-xs text-ink-soft">
                      <div>{t.temperatureRange} {day.temperature_2m_min_c ?? "—"}° – {day.temperature_2m_max_c ?? "—"}°C</div>
                      <div>{t.maxWind} {day.wind_speed_10m_max_kmh ?? "—"} km/h</div>
                      <div>{t.rainHours} {day.precipitation_hours ?? "—"}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 rounded-lg border border-info/30 bg-info-soft p-4">
              <p className="text-sm font-semibold text-info">
                {t.next48h}{" "}
                {forecast.expected_rain_next_48h_mm === null
                  ? t.next48hUnavailable
                  : t.next48hForecast.replace("{mm}", String(forecast.expected_rain_next_48h_mm))}
              </p>
              <p className="mt-1 text-xs text-info">{t.next48hNote}</p>
              <p className="mt-2 text-xs text-info">{forecast.freshness.caveat}</p>
            </div>
          </>
        ) : (
          <div role="status" className="rounded-lg border border-amber bg-amber-soft p-4">
            <p className="text-sm font-semibold text-amber-ink">{t.forecastUnavailable}</p>
            <p className="mt-1 text-sm leading-6 text-amber-ink">
              {forecast.freshness.caveat.toLowerCase().includes("429") ||
              forecast.freshness.caveat.toLowerCase().includes("too many requests")
                ? t.forecastRateLimited
                : t.forecastNoData}{" "}
              {t.forecastNotZero}
            </p>
          </div>
        )}
      </div>

      {/* Transparent "Why?" Drawer */}
      <div className="overflow-hidden rounded-xl border border-divider bg-white shadow-float">
        <button
          aria-expanded={whyOpen}
          aria-controls="decision-explanation"
          onClick={() => setWhyOpen(!whyOpen)}
          className="flex w-full items-center justify-between bg-action-soft/70 px-6 py-4 text-left transition hover:bg-action-soft"
        >
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-5 h-5 text-leaf" />
            <span className="text-base font-bold text-forest">{t.whyDecision}</span>
          </div>
          {whyOpen ? (
            <ChevronUp className="w-5 h-5 text-leaf" />
          ) : (
            <ChevronDown className="w-5 h-5 text-leaf" />
          )}
        </button>

        {whyOpen && (
          <div id="decision-explanation" className="space-y-3 border-t border-divider p-6">
            {decision.rule_contributions.map((rule, idx) => {
              const isRisky = rule.impact === "RISKY";
              return (
                <div
                  key={idx}
                  className={`flex flex-col rounded-lg border p-4 sm:flex-row sm:items-center justify-between gap-3 ${
                    isRisky ? "border-danger/30 bg-danger-soft/60" : "border-divider bg-action-soft/40"
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-ink">{rule.parameter}</span>
                      <span className="tnum rounded border border-line bg-white px-2 py-0.5 font-mono text-xs text-ink">
                        {rule.observed_value}
                      </span>
                    </div>
                    <p className="text-xs text-ink-soft leading-relaxed">{rule.explanation}</p>
                  </div>
                  <span
                    className={`self-start rounded-full px-2.5 py-1 text-[11px] font-semibold sm:self-center shrink-0 ${
                      isRisky ? "bg-danger-soft text-danger" : "bg-action-soft text-forest"
                    }`}
                  >
                    {rule.impact}
                  </span>
                </div>
              );
            })}

            {decision.rule_contributions.some((rule) => rule.evidence_status?.includes("PENDING")) && <p className="rounded-lg border border-amber bg-amber-soft p-3 text-xs font-semibold text-amber-ink">{t.assumptionsPending}</p>}
            <p className="border-t border-divider pt-2 text-xs text-ink-muted">{decision.disclaimer}</p>
          </div>
        )}
      </div>

      <FarmerContentPanel lang={lang} />

      <section className="space-y-3 rounded-xl border border-leaf bg-action-soft p-5">
        <div className="flex items-center gap-2 text-forest"><ShieldCheck className="h-5 w-5" /><h3 className="font-extrabold">{t.safetyTitle}</h3></div>
        <ul className="grid gap-2 text-sm text-forest sm:grid-cols-2">
          {t.safetyBullets.map((bullet, index) => (
            <li key={index}>• {bullet}</li>
          ))}
        </ul>
        <p className="text-xs leading-5 text-forest">{t.safetyNote}</p>
      </section>

      {/* Next Step Navigation */}
      <div className="flex justify-end">
        <button
          onClick={onProceedToTrends}
          className="flex items-center gap-2 rounded-full bg-action px-8 py-4 font-bold text-lg text-white transition hover:bg-action-pressed disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t.nextTrends}
          <ArrowRight className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}
