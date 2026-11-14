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

interface ScreenDTrendsProps {
  data: FieldAssessmentResponse | null;
  onProceedToMethods: () => void;
  lang: "en" | "ne";
}

export default function ScreenDTrends({
  data,
  onProceedToMethods,
  lang,
}: ScreenDTrendsProps) {
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
        {lang === "ne"
          ? "कृपया पहिले स्थान छान्नुहोस् र डेटा लोड गर्नुहोस्।"
          : "Please select a field location and run the assessment first."}
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
              {lang === "ne"
                ? "४. दीर्घकालीन वर्षा र जलवायु परिवर्तन प्रमाण"
                : "4. Changing Conditions: Heavy-Rain Frequency Trend"}
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
                Statistically Significant Shift (FDR Adjusted)
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4 text-slate-600" />
                No Significant Shift Detected (Natural Variability)
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
            <div className="text-xs font-semibold text-gray-500 uppercase">Theil-Sen Slope</div>
            <div className="text-2xl font-bold text-gray-900 mt-1">
              {climate_trend.theil_sen_slope_per_decade > 0 ? "+" : ""}
              {climate_trend.theil_sen_slope_per_decade}
              <span className="text-xs font-normal text-gray-500 ml-1">days / decade</span>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
            <div className="text-xs font-semibold text-gray-500 uppercase">95% Confidence Interval</div>
            <div className="text-lg font-bold text-gray-900 mt-1 font-mono">
              [{climate_trend.confidence_interval_lower}, {climate_trend.confidence_interval_upper}]
            </div>
            <div className="text-xs text-gray-500 mt-0.5">days / decade</div>
          </div>

          <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
            <div className="text-xs font-semibold text-gray-500 uppercase">FDR-Corrected p-value</div>
            <div className="text-2xl font-bold text-gray-900 mt-1 font-mono">
              {climate_trend.corrected_p_value}
            </div>
            <div className="text-xs text-gray-500 mt-0.5">
              Raw MK p = {climate_trend.mann_kendall_p_value.toFixed(4)}
            </div>
          </div>

          <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
            <div className="text-xs font-semibold text-gray-500 uppercase">Record Length</div>
            <div className="text-2xl font-bold text-gray-900 mt-1">
              {climate_trend.years_analyzed} <span className="text-sm font-normal text-gray-600">years</span>
            </div>
            <div className="text-xs text-gray-500 mt-0.5">NASA POWER Daily Archive</div>
          </div>
        </div>
      </div>

      {/* Historical Time-Series Chart */}
      <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <Activity className="w-5 h-5 text-emerald-700" />
          <h3 className="text-lg font-bold text-gray-900">
            {lang === "ne"
              ? "वार्षिक भारी वर्षा दिनहरू (≥ १५ मिमी/दिन) र प्रवृत्ति रेखा"
              : "Annual Heavy-Rain Days (≥ 15 mm/day) & Theil-Sen Trend"}
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
                  label={{ value: "Heavy Rain Days", angle: -90, position: "insideLeft", fontSize: 12 }}
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
                  name="Heavy Rain Days (≥ 15 mm)"
                  fill="#2e6930"
                  radius={[6, 6, 0, 0]}
                />
                <Line
                  type="monotone"
                  dataKey="trendLine"
                  name="Theil-Sen Trend Line"
                  stroke="#d97706"
                  strokeWidth={3}
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-sm text-gray-500">No historical yearly data available to chart.</p>
        )}
      </div>

      {/* Navigation */}
      <div className="flex justify-end">
        <button
          onClick={onProceedToMethods}
          className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white px-8 py-4 rounded-xl font-bold text-lg shadow-md transition"
        >
          {lang === "ne" ? "डाटा स्रोत र वैज्ञानिक विधि हेर्नुहोस्" : "Next: Methods & Data Provenance"}
          <ArrowRight className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}