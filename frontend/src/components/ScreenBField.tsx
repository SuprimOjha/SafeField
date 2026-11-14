"use client";

import React, { useState } from "react";
import { FieldAssessmentResponse } from "@/types/safefield";
import { CloudRain, Droplets, Thermometer, Mountain, Layers, CheckCircle2, RefreshCw, ArrowRight } from "lucide-react";

interface ScreenBFieldProps {
  data: FieldAssessmentResponse | null;
  loading: boolean;
  fertilizerType: string;
  setFertilizerType: (val: string) => void;
  cropStage: string;
  setCropStage: (val: string) => void;
  onRunAssessment: () => void;
  onProceedToDecision: () => void;
  lang: "en" | "ne";
}

export default function ScreenBField({
  data,
  loading,
  fertilizerType,
  setFertilizerType,
  cropStage,
  setCropStage,
  onRunAssessment,
  onProceedToDecision,
  lang,
}: ScreenBFieldProps) {
  const [customSand, setCustomSand] = useState<number | null>(null);

  if (loading || !data) {
    return (
      <div className="bg-white p-12 rounded-2xl shadow-sm border border-emerald-100 text-center space-y-4">
        <RefreshCw className="w-10 h-10 text-emerald-700 animate-spin mx-auto" />
        <h3 className="text-xl font-bold text-emerald-900">
          {lang === "ne" ? "नासा उपग्रह डेटा र माटोको विश्लेषण गर्दै..." : "Fetching Live NASA Earth Observations & Soil Data..."}
        </h3>
        <p className="text-gray-600 text-sm">
          {lang === "ne"
            ? "GPM IMERG, SMAP, NASA POWER र ISRIC SoilGrids बाट डाटा लोड हुँदैछ।"
            : "Querying GPM IMERG, SMAP, NASA POWER, and ISRIC SoilGrids over your field..."}
        </p>
      </div>
    );
  }

  const { power_summary, elevation, soil_texture, forecast } = data;
  const sandVal = customSand !== null ? customSand : soil_texture.sand_percent;

  return (
    <div className="space-y-6">
      {/* Freshness banner */}
      <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-xl flex items-center justify-between text-xs text-emerald-900">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
          <span>
            <strong>{power_summary.freshness.dataset_name}</strong> | Latest Observation: {power_summary.freshness.latest_observation_date || "N/A"} ({power_summary.freshness.status})
          </span>
        </div>
        <span className="text-emerald-700 font-mono hidden md:inline">Latency: {power_summary.freshness.typical_latency}</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* 72h Rain */}
        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-gray-600">
              {lang === "ne" ? "पछिल्लो ७२ घन्टाको वर्षा" : "Rain Last 72 Hours"}
            </span>
            <CloudRain className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <span className="text-3xl font-bold text-gray-900">{power_summary.rain_last_72h_mm ?? 0}</span>
            <span className="text-gray-500 ml-1">mm</span>
          </div>
          <span className="text-xs text-gray-400 mt-2">NASA POWER Daily PRECTOTCORR</span>
        </div>

        {/* Soil Wetness */}
        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-gray-600">
              {lang === "ne" ? "माटोको चिस्यान (Surface Wetness)" : "Surface Soil Wetness"}
            </span>
            <Droplets className="w-6 h-6 text-emerald-600" />
          </div>
          <div>
            <span className="text-3xl font-bold text-gray-900">
              {power_summary.latest_surface_wetness !== null ? Math.round(power_summary.latest_surface_wetness * 100) : "N/A"}
            </span>
            <span className="text-gray-500 ml-1">%</span>
          </div>
          <span className="text-xs text-gray-400 mt-2">NASA POWER GWETTOP (surface wetness proxy)</span>
        </div>

        {/* Temperature */}
        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-gray-600">
              {lang === "ne" ? "दैनिक हावाको तापक्रम" : "Air Temperature"}
            </span>
            <Thermometer className="w-6 h-6 text-amber-600" />
          </div>
          <div>
            <span className="text-3xl font-bold text-gray-900">{power_summary.latest_temp_c ?? "N/A"}</span>
            <span className="text-gray-500 ml-1">°C</span>
          </div>
          <span className="text-xs text-gray-400 mt-2">NASA POWER Daily T2M</span>
        </div>

        {/* Slope & Terrain */}
        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-gray-600">
              {lang === "ne" ? "ढाल र सतह (Slope)" : "Terrain & Slope"}
            </span>
            <Mountain className="w-6 h-6 text-stone-600" />
          </div>
          <div>
            <span className="text-3xl font-bold text-gray-900">{elevation.slope_percent}%</span>
            <span className="text-xs text-emerald-800 font-semibold block mt-1">{elevation.terrain_category}</span>
          </div>
          <span className="text-xs text-gray-400 mt-2">NASADEM 30m</span>
        </div>
      </div>

      {/* Input Configuration Card */}
      <div className="bg-white p-6 rounded-2xl border border-emerald-100 shadow-sm space-y-6">
        <h3 className="text-xl font-bold text-emerald-900">
          {lang === "ne" ? "मल र बाली विवरण छाنوहोस्" : "Select Fertilizer & Crop Stage"}
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Fertilizer Type */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              {lang === "ne" ? "मलको प्रकार (Fertilizer Type)" : "Fertilizer Type"}
            </label>
            <select
              value={fertilizerType}
              onChange={(e) => setFertilizerType(e.target.value)}
              className="w-full bg-gray-50 border border-gray-300 rounded-xl px-4 py-3 font-medium text-gray-900 focus:ring-2 focus:ring-emerald-600"
            >
              <option value="Urea">Urea (High Volatilization Risk)</option>
              <option value="DAP">DAP (Diammonium Phosphate)</option>
              <option value="Compost/FYM">Compost / Farmyard Manure</option>
            </select>
          </div>

          {/* Crop Stage */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              {lang === "ne" ? "बालीको चरण (Crop Stage)" : "Crop Stage"}
            </label>
            <select
              value={cropStage}
              onChange={(e) => setCropStage(e.target.value)}
              className="w-full bg-gray-50 border border-gray-300 rounded-xl px-4 py-3 font-medium text-gray-900 focus:ring-2 focus:ring-emerald-600"
            >
              <option value="Basal / Planting">Basal / Planting</option>
              <option value="Vegetative / Tillering">Vegetative / Tillering</option>
              <option value="Flowering / Grain Filling">Flowering / Grain Filling</option>
            </select>
          </div>

          {/* Soil Texture / Sand Slider */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              {lang === "ne" ? `माटोको बनावट (Sand %: ${sandVal}%)` : `Soil Texture (Sand %: ${sandVal}%)`}
            </label>
            <input
              type="range"
              min="10"
              max="80"
              value={sandVal}
              onChange={(e) => setCustomSand(Number(e.target.value))}
              className="w-full accent-emerald-700 h-2 bg-gray-200 rounded-lg cursor-pointer mt-3"
            />
            <span className="text-xs text-gray-500 mt-1 block">
              ISRIC SoilGrids baseline: {soil_texture.texture_class} ({soil_texture.sand_percent}% sand)
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row justify-between items-center gap-4 pt-4 border-t border-gray-100">
          <button
            onClick={onRunAssessment}
            className="flex items-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-800 px-6 py-3 rounded-xl font-semibold transition"
          >
            <RefreshCw className="w-4 h-4" />
            {lang === "ne" ? "डेटा ताजा गर्नुहोस्" : "Re-run Assessment"}
          </button>

          <button
            onClick={onProceedToDecision}
            className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white px-8 py-4 rounded-xl font-bold text-lg shadow-md transition"
          >
            {lang === "ne" ? "निर्णय हेर्नुहोस् (View Decision)" : "Next: View Fertilizer Decision"}
            <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}