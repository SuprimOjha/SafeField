"use client";

import React, { useCallback, useEffect, useState, useSyncExternalStore, useTransition, useRef } from "react";
import { FieldAssessmentResponse } from "@/types/safefield";
import { fetchFieldAssessment } from "@/lib/api";
import ScreenAHome from "@/components/ScreenAHome";
import ScreenBField from "@/components/ScreenBField";
import ScreenCDecision from "@/components/ScreenCDecision";
import ScreenDTrends from "@/components/ScreenDTrends";
import ScreenEMethods from "@/components/ScreenEMethods";
import {
  MapPin,
  SlidersHorizontal,
  CheckCircle2,
  TrendingUp,
  Database,
  Globe2,
  WifiOff,
  Leaf,
} from "lucide-react";

type TabId = "home" | "field" | "decision" | "trends" | "methods";

function subscribeToOnlineStatus(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

function getOnlineStatus() {
  return navigator.onLine;
}

function getServerOnlineStatus() {
  return true;
}

const NAV_ITEMS = [
  { id: "home", labelEn: "Choose location", shortEn: "Location", labelNe: "स्थान छान्नुहोस्", icon: MapPin },
  { id: "field", labelEn: "My field", shortEn: "My field", labelNe: "मेरो खेत", icon: SlidersHorizontal },
  { id: "decision", labelEn: "Recommendations", shortEn: "Advice", labelNe: "सुझाव", icon: CheckCircle2 },
  { id: "trends", labelEn: "Climate trends", shortEn: "Trends", labelNe: "जलवायु प्रवृत्ति", icon: TrendingUp },
  { id: "methods", labelEn: "Data & methods", shortEn: "Data", labelNe: "डाटा र विधि", icon: Database },
] as const;

export default function SafeFieldNepalApp() {
  const [activeTab, setActiveTab] = useState<TabId>("home");
  const [lang, setLang] = useState<"en" | "ne">("en");
  const [languageLoaded, setLanguageLoaded] = useState(false);
  const requestSequence = useRef(0);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("safefield_language");
      if (saved === "en" || saved === "ne") setLang(saved);
      setLanguageLoaded(true);
    } catch {
      // Language preference remains session-only when storage is unavailable.
    }
  }, []);

  useEffect(() => {
    if (!languageLoaded) return;
    try { window.localStorage.setItem("safefield_language", lang); } catch {
      // Ignore storage restrictions; the in-memory preference still works.
    }
  }, [lang]);
  const isOnline = useSyncExternalStore(subscribeToOnlineStatus, getOnlineStatus, getServerOnlineStatus);
  const [partnerLogoVisible, setPartnerLogoVisible] = useState(true);

  const [selectedLat, setSelectedLat] = useState<number>(26.45);
  const [selectedLon, setSelectedLon] = useState<number>(87.28);
  const [fertilizerType, setFertilizerType] = useState<string>("Urea");
  const [cropStage, setCropStage] = useState<string>("Vegetative / Tillering");
  const [sandPercentOverride, setSandPercentOverride] = useState<number | null>(null);

  const [assessmentData, setAssessmentData] = useState<FieldAssessmentResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [, startTransition] = useTransition();

  // Fetching starts after the effect runs; state updates happen only after the
  // asynchronous request settles, avoiding synchronous state updates in effects.
  const refreshAssessment = useCallback(async () => {
    const requestId = ++requestSequence.current;
    try {
      const data = await fetchFieldAssessment(
        selectedLat,
        selectedLon,
        fertilizerType,
        cropStage,
        true,
        sandPercentOverride,
      );
      if (requestId === requestSequence.current) startTransition(() => setAssessmentData(data));
    } catch (err) {
      if (requestId === requestSequence.current) console.error("Failed to fetch field assessment:", err);
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, [selectedLat, selectedLon, fertilizerType, cropStage, sandPercentOverride, startTransition]);

  const handleRunAssessment = useCallback(() => {
    setLoading(true);
    void refreshAssessment();
  }, [refreshAssessment]);

  useEffect(() => {
    void refreshAssessment();
  }, [refreshAssessment]);

  const selectTab = (tab: TabId) => {
    setActiveTab(tab);
  };

  const currentTab = NAV_ITEMS.find((item) => item.id === activeTab);

  return (
    <main id="main-content" className="min-h-screen bg-[#f5f8f4] text-[#183326] flex flex-col">
      {!isOnline && (
        <div className="bg-rose-800 text-white px-4 py-2.5 text-center text-xs font-semibold flex items-center justify-center gap-2">
          <WifiOff className="w-4 h-4 shrink-0" />
          <span>
            {lang === "ne"
              ? "तपाईं अफलाइन हुनुहुन्छ। स्थानीय क्यासबाट पछिल्लो सुरक्षित डाटा देखाइएको छ।"
              : "You are offline. Showing the latest available cached data."}
          </span>
        </div>
      )}

      <header className="sticky top-0 z-50 border-b border-emerald-950/10 bg-white/95 shadow-[0_8px_30px_rgba(15,55,35,0.07)] backdrop-blur-xl">
        <div className="mx-auto flex min-h-[78px] max-w-[1440px] items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
          <button
            type="button"
            onClick={() => selectTab("home")}
            className="group flex min-w-0 items-center gap-3 rounded-2xl text-left outline-none transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-4"
            aria-label="Safe Field Nepal home"
          >
            <span className="flex min-w-0 flex-col items-start gap-1">
              <img
                src="/logo.png"
                alt="Safe Field logo"
                className="h-11 w-auto max-w-[190px] shrink-0 object-contain sm:h-12 sm:max-w-[220px]"
              />
              <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-emerald-700 sm:text-[10px] sm:tracking-[0.16em]">
                Earth intelligence for every field
              </span>
            </span>
          </button>

          <div className="hidden h-9 w-px bg-emerald-900/10 lg:block" />

          <div className="hidden min-w-0 flex-1 items-center justify-center gap-2 lg:flex">
            <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-800 ring-1 ring-emerald-700/10">
              NASA Earth data
            </span>
            <span className="text-xs font-medium text-slate-500">Field decisions, backed by evidence</span>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {partnerLogoVisible && (
              <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 sm:h-11 sm:w-11" title="Partner logo — replace the image in frontend/public">
                <img
                  src="/partner-logo.png"
                  alt="Partner organization logo"
                  className="h-full w-full object-contain"
                  onError={() => setPartnerLogoVisible(false)}
                />
              </div>
            )}
            <span className="hidden rounded-full border border-emerald-100 bg-emerald-50 px-3 py-2 text-[11px] font-semibold text-emerald-800 sm:inline-flex sm:items-center sm:gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              {isOnline ? "System online" : "Offline"}
            </span>
            <button
              type="button"
              onClick={() => setLang(lang === "en" ? "ne" : "en")}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 shadow-sm transition hover:border-emerald-300 hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
              aria-label={lang === "en" ? "Switch to Nepali" : "Switch to English"}
            >
              <Globe2 className="h-4 w-4 text-emerald-700" />
              <span>{lang === "en" ? "नेपाली" : "English"}</span>
            </button>
          </div>
        </div>

        <nav aria-label="Main navigation" className="hidden border-t border-slate-100 bg-[#fbfdfb] lg:block">
          <div className="mx-auto flex max-w-[1440px] items-center gap-1 px-6 lg:px-8">
            {NAV_ITEMS.map((item, index) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => selectTab(item.id)}
                  aria-current={isActive ? "page" : undefined}
                  className={`relative flex min-h-[58px] items-center gap-2.5 px-5 text-[13px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-600 ${
                    isActive
                      ? "text-emerald-900"
                      : "text-slate-500 hover:bg-emerald-50/80 hover:text-emerald-800"
                  }`}
                >
                  <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${isActive ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500"}`}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <span>{lang === "ne" ? item.labelNe : item.labelEn}</span>
                  {isActive && <span className="absolute inset-x-4 bottom-0 h-[3px] rounded-t-full bg-emerald-600" />}
                  {index < NAV_ITEMS.length - 1 && !isActive && <span className="sr-only">Navigation item</span>}
                </button>
              );
            })}
            <div className="ml-auto flex items-center gap-2 py-2 text-[11px] font-medium text-slate-400">
              <Leaf className="h-3.5 w-3.5 text-emerald-600" />
              Built for Nepal&apos;s farming communities
            </div>
          </div>
        </nav>
      </header>

      <section className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col px-3 py-5 pb-28 sm:px-6 sm:py-7 sm:pb-28 lg:px-8 lg:py-9 lg:pb-9">
        <div className="mb-5 flex items-center justify-between gap-3 px-1">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-700 sm:text-[11px]">SAFE FIELD NEPAL / 2026</p>
            <h1 className="mt-1 truncate text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl">
              {lang === "ne" ? currentTab?.labelNe : currentTab?.labelEn}
            </h1>
          </div>
          <div className="hidden items-center gap-2 rounded-full border border-emerald-100 bg-white px-3 py-2 text-[11px] font-semibold text-slate-500 shadow-sm sm:flex">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            Nepal pilot region
          </div>
        </div>

        {activeTab === "home" && (
          <ScreenAHome
            selectedLat={selectedLat}
            selectedLon={selectedLon}
            onLocationSelect={(lat, lon) => {
              setSelectedLat(lat);
              setSelectedLon(lon);
            }}
            onProceedToField={() => selectTab("field")}
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
            sandPercentOverride={sandPercentOverride}
            onSandOverrideChange={setSandPercentOverride}
            onRunAssessment={handleRunAssessment}
            onProceedToDecision={() => selectTab("decision")}
            lang={lang}
          />
        )}

        {activeTab === "decision" && (
          <ScreenCDecision
            data={assessmentData}
            onProceedToTrends={() => selectTab("trends")}
            lang={lang}
          />
        )}

        {activeTab === "trends" && (
          <ScreenDTrends
            data={assessmentData}
            onProceedToMethods={() => selectTab("methods")}
            lang={lang}
          />
        )}

        {activeTab === "methods" && <ScreenEMethods data={assessmentData} lang={lang} />}
      </section>

      <nav aria-label="Mobile navigation" className="fixed inset-x-0 bottom-0 z-[60] border-t border-emerald-900/10 bg-white/95 px-1 pb-[max(env(safe-area-inset-bottom),8px)] pt-2 shadow-[0_-8px_28px_rgba(15,55,35,0.10)] backdrop-blur-xl lg:hidden">
        <div className="mx-auto grid max-w-xl grid-cols-5 gap-0.5">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => selectTab(item.id)}
                aria-current={isActive ? "page" : undefined}
                className={`flex min-w-0 min-h-[58px] flex-col items-center justify-center gap-1 rounded-xl px-1 py-1 text-[10px] font-semibold transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-600 ${isActive ? "bg-emerald-50 text-emerald-800" : "text-slate-500 hover:bg-slate-50"}`}
              >
                <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${isActive ? "bg-emerald-700 text-white shadow-sm" : "text-slate-500"}`}>
                  <Icon className="h-[17px] w-[17px]" />
                </span>
                <span className="max-w-full truncate">{lang === "ne" ? item.labelNe : item.shortEn}</span>
              </button>
            );
          })}
        </div>
      </nav>
      <footer className="mt-auto border-t border-emerald-950/10 bg-[#102f24] text-white">
        <div className="mx-auto grid max-w-[1440px] gap-9 px-5 py-10 sm:px-8 md:grid-cols-2 lg:grid-cols-[1.25fr_0.8fr_1.2fr] lg:gap-12 lg:px-10 lg:py-12">
          <div>
            <img src="/logo.png" alt="Safe Field logo" className="h-12 w-auto max-w-[210px] object-contain object-left" />
            <p className="mt-3 max-w-sm text-sm leading-6 text-emerald-50/75">Earth intelligence for every field. Safe Field Nepal helps farmers explore satellite, weather and environmental evidence alongside their own field information.</p>
            <p className="mt-4 text-xs font-semibold text-emerald-200">NASA International Space Apps Challenge 2026</p>
          </div>

          <div>
            <h2 className="text-xs font-extrabold uppercase tracking-[0.16em] text-white">Explore</h2>
            <ul className="mt-4 space-y-3 text-sm text-emerald-50/75">
              {NAV_ITEMS.map((item) => (
                <li key={item.id}>
                  <button type="button" onClick={() => { selectTab(item.id); window.scrollTo({ top: 0, behavior: "smooth" }); }} className="transition hover:text-white focus-visible:outline-none focus-visible:underline">
                    {item.labelEn}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h2 className="text-xs font-extrabold uppercase tracking-[0.16em] text-white">Data & responsible use</h2>
            <p className="mt-4 text-sm leading-6 text-emerald-50/75">The current assessment calls NASA POWER, Open-Meteo, ISRIC SoilGrids and Open-Elevation. GPM IMERG, SMAP and NASADEM are not connected to this assessment endpoint. Availability, resolution and update frequency vary by source.</p>
            <p className="mt-3 text-xs leading-5 text-emerald-100/60">This tool provides research-informed estimates, not a substitute for field measurements, official land surveys or advice from local agricultural experts. Verify important decisions on the ground.</p>
          </div>
        </div>
        <div className="border-t border-white/10">
          <div className="mx-auto flex max-w-[1440px] flex-col gap-2 px-5 py-4 text-[11px] text-emerald-100/55 sm:px-8 md:flex-row md:items-center md:justify-between lg:px-10">
            <span>© {new Date().getFullYear()} Safe Field Nepal. Built for Nepal&apos;s farming communities.</span>
            <span>Earth intelligence for every field.</span>
          </div>
        </div>
      </footer>
    </main>
  );
}
