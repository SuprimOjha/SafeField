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
      <div className="bg-white p-8 rounded-2xl border border-gray-200 text-center text-gray-600">
        {t.selectFirst}
      </div>
    );
  }

  const { climate_trend } = data;

  return (
    <div className="space-y-6">
      {/* Statistical Verdict Card */}
      <div className="bg-white p-6 rounded-2xl border border-emerald-100 shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <TrendingUp className="w-6 h-6 text-emerald-800" />
            <h2 className="text-2xl font-bold text-emerald-950">
              {t.trendsTitle}
            </h2>
          </div>

          <span
            className={`inline-flex items-center gap-1.5 text-xs font-bold px-3.5 py-1.5 rounded-full ${
              climate_trend.significant_after_fdr
                ? "bg-amber-100 text-amber-900 border border-amber-300"
                : "bg-slate-100 text-slate-800 border border-slate-300"
            }`}
          >
            {climate_trend.significant_after_fdr ? (
              <>
                <AlertCircle className="w-4 h-4 text-amber-700" />
                {t.badgeSignificant}
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4 text-slate-600" />
                {t.badgeNotSignificant}
              </>
            )}
          </span>
        </div>

        <p className="text-base text-gray-800 bg-emerald-50/60 border border-emerald-200 p-4 rounded-xl leading-relaxed">
          {climate_trend.plain_language_summary}
        </p>

        {/* Key Statistical Metrics */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-2">
          <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
            <div className="text-xs font-semibold text-gray-500 uppercase">{t.metricTheilSen}</div>
            <div className="text-2xl font-bold text-gray-900 mt-1">
              {climate_trend.theil_sen_slope_per_decade > 0 ? "+" : ""}
              {climate_trend.theil_sen_slope_per_decade}
              <span className="text-xs font-normal text-gray-500 ml-1">{t.daysPerDecade}</span>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
            <div className="text-xs font-semibold text-gray-500 uppercase">{t.metricCi}</div>
            <div className="text-lg font-bold text-gray-900 mt-1 font-mono">
              [{climate_trend.confidence_interval_lower}, {climate_trend.confidence_interval_upper}]
            </div>
            <div className="text-xs text-gray-500 mt-0.5">{t.daysPerDecade}</div>
          </div>

          <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
            <div className="text-xs font-semibold text-gray-500 uppercase">{t.metricPValue}</div>
            <div className="text-2xl font-bold text-gray-900 mt-1 font-mono">
              {climate_trend.corrected_p_value}
            </div>
            <div className="text-xs text-gray-500 mt-0.5">
              {t.rawMkP} {climate_trend.mann_kendall_p_value.toFixed(4)}
            </div>
          </div>

          <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
            <div className="text-xs font-semibold text-gray-500 uppercase">{t.metricRecordLength}</div>
            <div className="text-2xl font-bold text-gray-900 mt-1">
              {climate_trend.years_analyzed} <span className="text-sm font-normal text-gray-600">{t.years}</span>
            </div>
            <div className="text-xs text-gray-500 mt-0.5">{t.recordSource}</div>
          </div>
        </div>
      </div>

      {/* Historical Time-Series Chart */}
      <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <Activity className="w-5 h-5 text-emerald-700" />
          <h3 className="text-lg font-bold text-gray-900">
            {t.chartTitle}
          </h3>
        </div>

        {annualSeries.length > 0 ? (
          <div className="w-full h-[340px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={annualSeries} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="year" tick={{ fontSize: 12, fill: "#374151" }} />
                <YAxis
                  tick={{ fontSize: 12, fill: "#374151" }}
                  label={{ value: t.yAxisLabel, angle: -90, position: "insideLeft", fontSize: 12 }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#ffffff",
                    borderColor: "#d1d5db",
                    borderRadius: "12px",
                    fontSize: "13px",
                  }}
                />
                <Legend />
                <Bar
                  dataKey="heavyRainDays"
                  name={t.legendHeavyDays}
                  fill="#2e6930"
                  radius={[6, 6, 0, 0]}
                />
                <Line
                  type="monotone"
                  dataKey="trendLine"
                  name={t.legendTrend}
                  stroke="#d97706"
                  strokeWidth={3}
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-sm text-gray-500">{t.noChartData}</p>
        )}
      </div>

      {/* Navigation */}
      <div className="flex justify-end">
        <button
          onClick={onProceedToMethods}
          className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white px-8 py-4 rounded-xl font-bold text-lg shadow-md transition"
        >
          {t.nextMethods}
          <ArrowRight className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}