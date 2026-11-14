"use client";

import React, { useState, useEffect, useTransition } from "react";
import { FieldAssessmentResponse } from "@/types/safefield";
import { fetchFieldAssessment } from "@/lib/api";
import ScreenAHome from "@/components/ScreenAHome";
import ScreenBField from "@/components/ScreenBField";
import ScreenCDecision from "@/components/ScreenCDecision";
import ScreenDTrends from "@/components/ScreenDTrends";
import ScreenEMethods from "@/components/ScreenEMethods";
import { MapPin, Sliders, CheckCircle, TrendingUp, Database, Globe, WifiOff, Sprout } from "lucide-react";

export default function SafeFieldNepalApp() {
  const [activeTab, setActiveTab] = useState<"home" | "field" | "decision" | "trends" | "methods">("home");
  const [lang, setLang] = useState<"en" | "ne">("en");
  const [isOnline, setIsOnline] = useState(true);

  // Field parameters
  const [selectedLat, setSelectedLat] = useState<number>(26.45);
  const [selectedLon, setSelectedLon] = useState<number>(87.28);
  const [locationLabel, setLocationLabel] = useState<string>("Biratnagar (Morang - Terai Hub)");
  const [fertilizerType, setFertilizerType] = useState<string>("Urea");
  const [cropStage, setCropStage] = useState<string>("Vegetative / Tillering");

  // Assessment Data & Loading State
  const [assessmentData, setAssessmentData] = useState<FieldAssessmentResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [, startTransition] = useTransition();

  useEffect(() => {
    function handleOnline() { setIsOnline(true); }
    function handleOffline() { setIsOnline(false); }
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    setIsOnline(navigator.onLine);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const handleRunAssessment = async () => {
    setLoading(true);
    try {
      const data = await fetchFieldAssessment(selectedLat, selectedLon, fertilizerType, cropStage, true);
      startTransition(() => {
        setAssessmentData(data);
        setLoading(false);
      });
    } catch (err) {
      console.error("Failed to fetch field assessment:", err);
      setLoading(false);
    }
  };

  // Auto-fetch when location changes
  useEffect(() => {
    handleRunAssessment();
  }, [selectedLat, selectedLon, fertilizerType, cropStage]);

  return (
    <main className="min-h-screen bg-[#f4f7f2] text-[#1c2821] flex flex-col">
      {/* Offline Banner */}
      {!isOnline && (
        <div className="bg-rose-800 text-white px-4 py-2.5 text-center text-xs font-bold flex items-center justify-center gap-2 shadow-inner">
          <WifiOff className="w-4 h-4" />
          <span>
            {lang === "ne"
              ? "तपाईं अफलाइन हुनुहुन्छ। स्थानीय SQLite क्यासबाट पछिल्लो सुरक्षित डाटा देखाइएको छ।"
              : "You are offline. Showing last cached NASA observation state from SQLite."}
          </span>
        </div>
      )}

      {/* Top Header */}
      <header className="bg-emerald-900 text-white shadow-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-emerald-800 p-2 rounded-xl border border-emerald-700">
              <Sprout className="w-6 h-6 text-emerald-200" />
            </div>
            <div>
              <h1 className="text-lg sm:text-xl font-bold tracking-tight">
                {lang === "ne" ? "सेफ फिल्ड नेपाल" : "Safe Field Nepal"}
              </h1>
              <p className="text-xs text-emerald-300 hidden sm:block">
                {lang === "ne" ? "NASA उपग्रह डेटा र जलवायु प्रमाण" : "NASA Earth Data & Climate Evidence for Fertilizer Timing"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setLang(lang === "en" ? "ne" : "en")}
              className="flex items-center gap-1.5 bg-emerald-800 hover:bg-emerald-700 text-emerald-100 text-xs font-semibold px-3.5 py-2 rounded-xl border border-emerald-700 transition"
            >
              <Globe className="w-4 h-4" />
              <span>{lang === "en" ? "नेपाली" : "English"}</span>
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="bg-emerald-950/40 border-t border-emerald-800/60 overflow-x-auto">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex space-x-1 sm:space-x-4">
            {[
              { id: "home", labelEn: "1. Location", labelNe: "१. स्थान", icon: MapPin },
              { id: "field", labelEn: "2. My Field", labelNe: "२. मेरो खेत", icon: Sliders },
              { id: "decision", labelEn: "3. Decision", labelNe: "३. निर्णय", icon: CheckCircle },
              { id: "trends", labelEn: "4. Changing Conditions", labelNe: "४. जलवायु परिवर्तन", icon: TrendingUp },
              { id: "methods", labelEn: "5. Methods & Data", labelNe: "५. विधि र स्रोतहरू", icon: Database },
            ].map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`flex items-center gap-2 py-3 px-3 sm:px-4 text-xs sm:text-sm font-semibold whitespace-nowrap border-b-2 transition ${
                    isActive
                      ? "border-emerald-400 text-white bg-emerald-900/60"
                      : "border-transparent text-emerald-200/70 hover:text-white hover:bg-emerald-900/30"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{lang === "ne" ? tab.labelNe : tab.labelEn}</span>
                </button>
              );
            })}
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
        {activeTab === "home" && (
          <ScreenAHome
            selectedLat={selectedLat}
            selectedLon={selectedLon}
            onLocationSelect={(lat, lon) => {
              setSelectedLat(lat);
              setSelectedLon(lon);
            }}
            onProceedToField={() => setActiveTab("field")}
            lang={lang}
          />
        )}

        {activeTab === "field" && (
          <ScreenBField
            data={assessmentData}
            loading={loading}
            fertilizerType={fertilizerType}
            setFertilizerType={setFertilizerType}
            cropStage={cropStage}
            setCropStage={setCropStage}
            onRunAssessment={handleRunAssessment}
            onProceedToDecision={() => setActiveTab("decision")}
            lang={lang}
          />
        )}

        {activeTab === "decision" && (
          <ScreenCDecision
            data={assessmentData}
            onProceedToTrends={() => setActiveTab("trends")}
            lang={lang}
          />
        )}

        {activeTab === "trends" && (
          <ScreenDTrends
            data={assessmentData}
            onProceedToMethods={() => setActiveTab("methods")}
            lang={lang}
          />
        )}

        {activeTab === "methods" && (
          <ScreenEMethods data={assessmentData} lang={lang} />
        )}
      </div>

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200 py-6 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-xs text-gray-500 space-y-1">
          <p>
            Safe Field Nepal • Built for NASA International Space Apps Challenge 2026.
          </p>
          <p>
            Powered by NASA POWER, GPM IMERG, SMAP, NASADEM, Open-Meteo, and ISRIC SoilGrids.
          </p>
        </div>
      </footer>
    </main>
  );
}