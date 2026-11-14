"use client";

import React, { useMemo } from "react";
import { FieldAssessmentResponse } from "@/types/safefield";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { TrendingUp, Activity, AlertCircle, CheckCircle2, ArrowRight } from "lucide-react";
import { getDict, type Lang } from "@/i18n";

interface ScreenDTrendsProps {
  data: FieldAssessmentResponse | null;
  onProceedToMethods: () => void;
  lang: Lang;
}

export default function ScreenDTrends({
  data,
  onProceedToMethods,
  lang,
}: ScreenDTrendsProps) {
  const t = getDict(lang);
  const annualSeries = useMemo(() => {
    if (!data?.power_summary?.historical_daily_records) return [];

    const byYear: Record<string, { year: string; heavyRainDays: number; totalPrecipMm: number }> = {};
    for (const rec of data.power_summary.historical_daily_records) {
      if (!rec.date || rec.precip_mm === null) continue;
      const yr = rec.date.slice(0, 4);
      if (!byYear[yr]) {
        byYear[yr] = { year: yr, heavyRainDays: 0, totalPrecipMm: 0 };
      }
      byYear[yr].totalPrecipMm = Math.round((byYear[yr].totalPrecipMm + rec.precip_mm) * 10) / 10;
      if (rec.precip_mm >= 15.0) {
        byYear[yr].heavyRainDays += 1;
      }
    }

    const sorted = Object.values(byYear).sort((a, b) => a.year.localeCompare(b.year));
    if (sorted.length === 0) return [];

    const slopePerYear = (data.climate_trend?.theil_sen_slope_per_decade ?? 0) / 10.0;
    const meanDays = sorted.reduce((acc, item) => acc + item.heavyRainDays, 0) / sorted.length;
    const midIdx = (sorted.length - 1) / 2;

    return sorted.map((item, idx) => ({
      ...item,
      trendLine: Math.max(0, Number((meanDays + (idx - midIdx) * slopePerYear).toFixed(2))),
    }));
  }, [data]);

  if (!data) {
    return (
      <div className="rounded-xl border border-divider bg-white p-8 text-center text-ink-soft shadow-float">
        {t.selectFirst}
      </div>
    );
  }

  const { climate_trend } = data;

  return (
    <div className="space-y-6">
      {/* Statistical Verdict Card */}
      <div className="rounded-xl border border-divider bg-white p-6 shadow-float space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <TrendingUp className="w-6 h-6 text-leaf" />
            <h2 className="text-2xl font-bold text-forest">
              {t.trendsTitle}
            </h2>
          </div>

          <span
            className={`inline-flex items-center gap-1.5 text-xs font-bold px-3.5 py-1.5 rounded-full ${
              climate_trend.significant_after_fdr
                ? "bg-amber-soft text-amber-ink border border-amber"
                : "bg-soft text-ink border border-line"
            }`}
          >
            {climate_trend.significant_after_fdr ? (
              <>
                <AlertCircle className="w-4 h-4 text-amber-ink" />
                {t.badgeSignificant}
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4 text-ink-soft" />
                {t.badgeNotSignificant}
              </>
            )}
          </span>
        </div>

        <p className="text-base text-ink bg-mint border border-divider p-4 rounded-lg leading-relaxed">
          {climate_trend.plain_language_summary}
        </p>

        {/* Key Statistical Metrics */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-2">
          <div className="p-4 rounded-lg bg-soft border border-divider">
            <div className="text-xs font-semibold text-ink-muted uppercase">{t.metricTheilSen}</div>
            <div className="text-2xl font-bold text-ink mt-1 tnum">
              {climate_trend.theil_sen_slope_per_decade > 0 ? "+" : ""}
              {climate_trend.theil_sen_slope_per_decade}
              <span className="text-xs font-normal text-ink-muted ml-1">{t.daysPerDecade}</span>
            </div>
          </div>

          <div className="p-4 rounded-lg bg-soft border border-divider">
            <div className="text-xs font-semibold text-ink-muted uppercase">{t.metricCi}</div>
            <div className="text-lg font-bold text-ink mt-1 font-mono tnum">
              [{climate_trend.confidence_interval_lower}, {climate_trend.confidence_interval_upper}]
            </div>
            <div className="text-xs text-ink-muted mt-0.5">{t.daysPerDecade}</div>
          </div>

          <div className="p-4 rounded-lg bg-soft border border-divider">
            <div className="text-xs font-semibold text-ink-muted uppercase">{t.metricPValue}</div>
            <div className="text-2xl font-bold text-ink mt-1 font-mono tnum">
              {climate_trend.corrected_p_value}
            </div>
            <div className="text-xs text-ink-muted mt-0.5 tnum">
              {t.rawMkP} {climate_trend.mann_kendall_p_value.toFixed(4)}
            </div>
          </div>

          <div className="p-4 rounded-lg bg-soft border border-divider">
            <div className="text-xs font-semibold text-ink-muted uppercase">{t.metricRecordLength}</div>
            <div className="text-2xl font-bold text-ink mt-1 tnum">
              {climate_trend.years_analyzed} <span className="text-sm font-normal text-ink-soft">{t.years}</span>
            </div>
            <div className="text-xs text-ink-muted mt-0.5">{t.recordSource}</div>
          </div>
        </div>
      </div>

      {/* Historical Time-Series Chart */}
      <div className="rounded-xl border border-divider bg-white p-6 shadow-float">
        <div className="flex items-center gap-2 mb-4">
          <Activity className="w-5 h-5 text-leaf" />
          <h3 className="text-lg font-bold text-forest">
            {t.chartTitle}
          </h3>
        </div>

        {annualSeries.length > 0 ? (
          <div className="w-full h-[340px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={annualSeries} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E4E9E2" />
                <XAxis dataKey="year" tick={{ fontSize: 12, fill: "#657168" }} />
                <YAxis
                  tick={{ fontSize: 12, fill: "#657168" }}
                  label={{ value: t.yAxisLabel, angle: -90, position: "insideLeft", fontSize: 12 }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#ffffff",
                    borderColor: "#E4E9E2",
                    borderRadius: "18px",
                    boxShadow: "0 4px 18px rgba(24, 44, 30, 0.1)",
                    fontSize: "13px",
                  }}
                />
                <Legend formatter={(value) => <span style={{ color: "#657168" }}>{value}</span>} />
                <Bar
                  dataKey="heavyRainDays"
                  name={t.legendHeavyDays}
                  fill="#2F8F4E"
                  radius={[6, 6, 0, 0]}
                />
                <Line
                  type="monotone"
                  dataKey="trendLine"
                  name={t.legendTrend}
                  stroke="#F2B93B"
                  strokeWidth={3}
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-sm text-ink-muted">{t.noChartData}</p>
        )}
      </div>

      {/* Navigation */}
      <div className="flex justify-end">
        <button
          onClick={onProceedToMethods}
          className="flex items-center gap-2 rounded-full bg-action px-8 py-4 text-lg font-semibold text-white shadow-float transition hover:bg-action-pressed"
        >
          {t.nextMethods}
          <ArrowRight className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}