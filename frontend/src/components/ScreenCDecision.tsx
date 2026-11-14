"use client";

import React, { useState } from "react";
import { FieldAssessmentResponse, DecisionSignal } from "@/types/safefield";
import FarmerContentPanel from "@/components/FarmerContentPanel";
import { getDict, type Lang } from "@/i18n";
import {
  CheckCircle2,
  AlertTriangle,
  Clock,
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
      <div className="bg-white p-8 rounded-2xl border border-gray-200 text-center text-gray-600">
        {t.selectFirst}
      </div>
    );
  }

  const { decision, forecast } = data;

  const getSignalTheme = (signal: DecisionSignal) => {
    if (signal === "CONDITIONS LOOK SUITABLE") {
      return {
        bg: "bg-emerald-800",
        border: "border-emerald-900",
        badgeBg: "bg-emerald-950/50 text-emerald-100",
        icon: <CheckCircle2 className="w-12 h-12 text-emerald-200 shrink-0" />,
        label: lang === "ne" ? t.signalSuitableNe : t.signalSuitable,
      };
    }
    if (signal === "WAIT AND RECHECK") {
      return {
        bg: "bg-rose-800",
        border: "border-rose-900",
        badgeBg: "bg-rose-950/50 text-rose-100",
        icon: <Clock className="w-12 h-12 text-rose-200 shrink-0" />,
        label:
          lang === "ne"
            ? `${t.signalWaitNe} — ${decision.wait_days_recommended} ${t.daysUnit}`
            : `${t.signalWait} — ${decision.wait_days_recommended} ${t.daysUnit}${decision.wait_days_recommended === 1 ? "" : "s"}`,
      };
    }
    return {
      bg: "bg-amber-50",
      border: "border-amber-300",
      badgeBg: "bg-amber-100 text-amber-950",
      icon: <AlertTriangle className="w-10 h-10 text-amber-700 shrink-0" />,
      label: lang === "ne" ? t.signalReviewNe : t.signalReview,
    };
  };

  const isLocalReview = decision.signal === "LOCAL REVIEW NEEDED";
  const theme = getSignalTheme(decision.signal);

  return (
    <div className="space-y-6">
      {/* Primary Outdoor Decision Banner */}
      <section aria-label={t.decisionBannerLabel} aria-live="polite" className={`${theme.bg} ${theme.border} border-2 ${isLocalReview ? "text-amber-950 p-5 md:p-6 shadow-sm" : "text-white p-6 md:p-8 shadow-md"} rounded-2xl` }>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start md:items-center gap-4">
            {theme.icon}
            <div>
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <span className={`text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full ${theme.badgeBg}`}>
                  {t.confidenceLabel} {decision.confidence}
                </span>
                {decision.wait_days_recommended > 0 && (
                  <span className="text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full bg-white text-rose-900">
                    {t.waitDaysLabel.replace("{days}", String(decision.wait_days_recommended))}
                  </span>
                )}
              </div>
              <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight">
                {theme.label}
              </h2>
            </div>
          </div>
        </div>

        <p className={`mt-3 text-base font-semibold ${isLocalReview ? "text-amber-950" : "text-white/95"}`}>{decision.primary_reason}</p>
        <p className={`mt-2 text-sm leading-relaxed ${isLocalReview ? "text-amber-900" : "text-white/85"}`}>{decision.detailed_explanation}</p>
        <p className={`mt-3 rounded-xl border p-3 text-xs leading-5 ${isLocalReview ? "border-amber-200 bg-white/70 text-amber-950" : "border-white/25 bg-white/10 text-white"}`}>{t.decisionFootnote}</p>
      </section>

      {/* 5-Day Non-NASA Rain Outlook Strip */}
      <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
          <div className="flex items-center gap-2">
            <CloudRain className="w-5 h-5 text-sky-700" />
            <h3 className="text-lg font-bold text-gray-900">{t.rainOutlook}</h3>
          </div>
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full bg-sky-50 text-sky-800 border border-sky-200">
            <Info className="w-3.5 h-3.5" />
            {t.nonNasaForecast}
          </span>
        </div>

        {forecast.forecast_days.length > 0 ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3 text-xs text-gray-600">
              <span className={`rounded-full px-2.5 py-1 font-bold ${forecast.freshness.status === "LIVE" ? "bg-emerald-100 text-emerald-900" : "bg-amber-100 text-amber-900"}`}>
                {forecast.freshness.status === "LIVE" ? t.liveForecast : t.cachedForecast}
              </span>
              <span>{t.fetchedAt} {new Date(forecast.freshness.fetched_at_utc).toLocaleString()}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              {forecast.forecast_days.map((day) => {
                const isWet = day.precipitation_sum_mm !== null && day.precipitation_sum_mm >= 5.0;
                return (
                  <div
                    key={day.date}
                    className={`p-3.5 rounded-xl border ${isWet ? "bg-sky-50 border-sky-300" : "bg-gray-50 border-gray-200"}`}
                  >
                    <div className="text-xs font-semibold text-gray-600">{day.date}</div>
                    <div className={`text-xl font-bold mt-1 ${isWet ? "text-sky-900" : "text-gray-900"}`}>
                      {day.precipitation_sum_mm ?? "N/A"} <span className="text-xs font-normal">{day.precipitation_sum_mm === null ? "" : t.mmRain}</span>
                    </div>
                    <div className="text-xs text-gray-600 mt-1">
                      {day.precipitation_probability_max !== null ? `${day.precipitation_probability_max}${t.rainChance}` : t.rainChanceUnavailable}
                    </div>
                    <div className="mt-2 border-t border-gray-200 pt-2 space-y-1 text-xs text-gray-600">
                      <div>{t.temperatureRange} {day.temperature_2m_min_c ?? "—"}° – {day.temperature_2m_max_c ?? "—"}°C</div>
                      <div>{t.maxWind} {day.wind_speed_10m_max_kmh ?? "—"} km/h</div>
                      <div>{t.rainHours} {day.precipitation_hours ?? "—"}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 rounded-xl border border-sky-200 bg-sky-50 p-4">
              <p className="text-sm font-semibold text-sky-950">
                {t.next48h}{" "}
                {forecast.expected_rain_next_48h_mm === null
                  ? t.next48hUnavailable
                  : t.next48hForecast.replace("{mm}", String(forecast.expected_rain_next_48h_mm))}
              </p>
              <p className="mt-1 text-xs text-sky-900">{t.next48hNote}</p>
              <p className="mt-2 text-xs text-sky-900">{forecast.freshness.caveat}</p>
            </div>
          </>
        ) : (
          <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm font-semibold text-amber-950">{t.forecastUnavailable}</p>
            <p className="mt-1 text-sm leading-6 text-amber-900">
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
      <div className="bg-white rounded-2xl border border-emerald-200 shadow-sm overflow-hidden">
        <button
          aria-expanded={whyOpen}
          aria-controls="decision-explanation"
          onClick={() => setWhyOpen(!whyOpen)}
          className="w-full px-6 py-4 bg-emerald-50/70 hover:bg-emerald-50 flex items-center justify-between text-left transition"
        >
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-5 h-5 text-emerald-800" />
            <span className="font-bold text-emerald-950 text-base">{t.whyDecision}</span>
          </div>
          {whyOpen ? (
            <ChevronUp className="w-5 h-5 text-emerald-800" />
          ) : (
            <ChevronDown className="w-5 h-5 text-emerald-800" />
          )}
        </button>

        {whyOpen && (
          <div id="decision-explanation" className="p-6 space-y-3 border-t border-emerald-100">
            {decision.rule_contributions.map((rule, idx) => {
              const isRisky = rule.impact === "RISKY";
              return (
                <div
                  key={idx}
                  className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                    isRisky ? "bg-rose-50/60 border-rose-200" : "bg-emerald-50/40 border-emerald-200"
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-gray-900 text-sm">{rule.parameter}</span>
                      <span className="text-xs font-mono bg-white px-2 py-0.5 rounded border border-gray-200 text-gray-800">
                        {rule.observed_value}
                      </span>
                    </div>
                    <p className="text-xs text-gray-700 leading-relaxed">{rule.explanation}</p>
                  </div>
                  <span
                    className={`self-start sm:self-center shrink-0 text-xs font-bold px-3 py-1 rounded-full ${
                      isRisky ? "bg-rose-700 text-white" : "bg-emerald-700 text-white"
                    }`}
                  >
                    {rule.impact}
                  </span>
                </div>
              );
            })}

            {decision.rule_contributions.some((rule) => rule.evidence_status?.includes("PENDING")) && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-900">{t.assumptionsPending}</p>}
            <p className="text-xs text-gray-500 pt-2 border-t border-gray-100">{decision.disclaimer}</p>
          </div>
        )}
      </div>

      <FarmerContentPanel lang={lang} />

      <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 space-y-3">
        <div className="flex items-center gap-2 text-emerald-950"><ShieldCheck className="h-5 w-5" /><h3 className="font-extrabold">{t.safetyTitle}</h3></div>
        <ul className="grid gap-2 text-sm text-emerald-950 sm:grid-cols-2">
          {t.safetyBullets.map((bullet, index) => (
            <li key={index}>• {bullet}</li>
          ))}
        </ul>
        <p className="text-xs leading-5 text-emerald-900">{t.safetyNote}</p>
      </section>

      {/* Next Step Navigation */}
      <div className="flex justify-end">
        <button
          onClick={onProceedToTrends}
          className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white px-8 py-4 rounded-xl font-bold text-lg shadow-md transition"
        >
          {t.nextTrends}
          <ArrowRight className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}
