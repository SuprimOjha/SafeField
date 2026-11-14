"use client";

import React, { useCallback, useState, useSyncExternalStore, useTransition, useRef } from "react";
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
} from "lucide-react";
import { getDict, type Lang } from "@/i18n";

type TabId = "home" | "field" | "decision" | "trends" | "methods";

function subscribeToLanguage(onChange: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", onChange);
  window.addEventListener("safefield-language-change", onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener("safefield-language-change", onChange);
  };
}

function getLanguageSnapshot(): Lang {
  if (typeof window === "undefined") return "ne";
  try {
    const saved = window.localStorage.getItem("safefield_language");
    return saved === "en" || saved === "ne" ? saved : "ne";
  } catch {
    return "ne";
  }
}

function getServerLanguageSnapshot(): Lang {
  return "ne";
}

function updateStoredLanguage(next: Lang) {
  try {
    window.localStorage.setItem("safefield_language", next);
  } catch {
    // Keep the in-memory/server default when storage is unavailable.
  }
  window.dispatchEvent(new Event("safefield-language-change"));
}

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
  const lang = useSyncExternalStore(subscribeToLanguage, getLanguageSnapshot, getServerLanguageSnapshot);
  const t = getDict(lang);
  const setLang = useCallback((next: Lang) => updateStoredLanguage(next), []);
  const requestSequence = useRef(0);

  const isOnline = useSyncExternalStore(subscribeToOnlineStatus, getOnlineStatus, getServerOnlineStatus);

  const [selectedLat, setSelectedLat] = useState<number>(26.45);
  const [selectedLon, setSelectedLon] = useState<number>(87.28);
  const [fertilizerType, setFertilizerType] = useState<string>("Urea");
  const [cropStage, setCropStage] = useState<string>("Vegetative / Tillering");
  const [sandPercentOverride, setSandPercentOverride] = useState<number | null>(null);
  const [selectedFieldPolygon, setSelectedFieldPolygon] = useState<[number, number][] | null>(null);

  const [assessmentData, setAssessmentData] = useState<FieldAssessmentResponse | null>(null);
  const [assessmentError, setAssessmentError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [, startTransition] = useTransition();

  // Fetching starts after the effect runs; state updates happen only after the
  // asynchronous request settles, avoiding synchronous state updates in effects.
  const refreshAssessment = useCallback(async () => {
    const requestId = ++requestSequence.current;
    setLoading(true);
    setAssessmentError(null);
    setAssessmentData(null);
    try {
      const data = await fetchFieldAssessment(
        selectedLat,
        selectedLon,
        fertilizerType,
        cropStage,
        true,
        sandPercentOverride,
        selectedFieldPolygon,
      );
      if (requestId === requestSequence.current) startTransition(() => setAssessmentData(data));
    } catch (err) {
      if (requestId === requestSequence.current) {
        const message = err instanceof Error ? err.message : "Unknown error while loading the field assessment.";
        setAssessmentError(message);
        console.error("Failed to fetch field assessment:", err);
      }
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, [selectedLat, selectedLon, fertilizerType, cropStage, sandPercentOverride, selectedFieldPolygon, startTransition]);

  const handleRunAssessment = useCallback(() => {
    void refreshAssessment();
  }, [refreshAssessment]);

  // Assessment is intentionally started by the explicit Next action, after
  // the user has selected the final point or drawn boundary. This prevents
  // an early/default-location request from racing the selected field request.
  const handleProceedToField = useCallback(() => {
    setActiveTab("field");
    void refreshAssessment();
  }, [refreshAssessment]);

  const selectTab = (tab: TabId) => {
    setActiveTab(tab);
  };

  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-[#f5f8f4] text-[#183326] flex flex-col">
      <a href="#main-content" className="sr-only z-[100] rounded-lg bg-white px-4 py-3 font-bold text-emerald-900 focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:ring-2 focus:ring-emerald-700">Skip to main content</a>
      {!isOnline && (
        <div className="bg-rose-800 text-white px-4 py-2.5 text-center text-xs font-semibold flex items-center justify-center gap-2">
          <WifiOff className="w-4 h-4 shrink-0" />
          <span>{t.offlineBanner}</span>
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
                {t.brandTagline}
              </span>
            </span>
          </button>

          <div className="flex shrink-0 items-center gap-2">
            <div
              role="group"
              aria-label={lang === "en" ? "Language selection" : "भाषा छनोट"}
              className="inline-flex min-h-10 items-center rounded-xl border border-slate-200 bg-white p-1 shadow-sm"
            >
              <Globe2 className="mx-1.5 h-4 w-4 text-emerald-700" aria-hidden="true" />
              <button
                type="button"
                onClick={() => setLang("en")}
                aria-pressed={lang === "en"}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 ${
                  lang === "en" ? "bg-emerald-700 text-white shadow-sm" : "text-slate-500 hover:text-emerald-800"
                }`}
              >
                EN
              </button>
              <button
                type="button"
                onClick={() => setLang("ne")}
                aria-pressed={lang === "ne"}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 ${
                  lang === "ne" ? "bg-emerald-700 text-white shadow-sm" : "text-slate-500 hover:text-emerald-800"
                }`}
              >
                ने
              </button>
            </div>
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
          </div>
        </nav>
      </header>

      <section className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col px-3 py-5 pb-28 sm:px-6 sm:py-7 sm:pb-28 lg:px-8 lg:py-9 lg:pb-9">
        {activeTab === "home" && (
          <ScreenAHome
            selectedLat={selectedLat}
            selectedLon={selectedLon}
            onLocationSelect={(lat, lon) => {
              setSelectedLat(lat);
              setSelectedLon(lon);
              setSelectedFieldPolygon(null);
            }}
            onFieldPolygonSelect={setSelectedFieldPolygon}
            onProceedToField={handleProceedToField}
            lang={lang}
          />
        )}

        {activeTab === "field" && (
          <ScreenBField
            data={assessmentData}
            loading={loading}
            error={assessmentError}
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
            <p className="mt-3 max-w-sm text-sm leading-6 text-emerald-50/75">{t.footerAbout}</p>
            <p className="mt-4 text-xs font-semibold text-emerald-200">{t.footerChallenge}</p>
          </div>

          <div>
            <h2 className="text-xs font-extrabold uppercase tracking-[0.16em] text-white">{t.footerExplore}</h2>
            <ul className="mt-4 space-y-3 text-sm text-emerald-50/75">
              {NAV_ITEMS.map((item) => (
                <li key={item.id}>
                  <button type="button" onClick={() => { selectTab(item.id); window.scrollTo({ top: 0, behavior: "smooth" }); }} className="transition hover:text-white focus-visible:outline-none focus-visible:underline">
                    {lang === "ne" ? item.labelNe : item.labelEn}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h2 className="text-xs font-extrabold uppercase tracking-[0.16em] text-white">{t.footerDataTitle}</h2>
            <p className="mt-4 text-sm leading-6 text-emerald-50/75">{t.footerDataBody}</p>
            <p className="mt-3 text-xs leading-5 text-emerald-100/60">{t.footerDisclaimer}</p>
          </div>
        </div>
        <div className="border-t border-white/10">
          <div className="mx-auto flex max-w-[1440px] flex-col gap-2 px-5 py-4 text-[11px] text-emerald-100/55 sm:px-8 md:flex-row md:items-center md:justify-between lg:px-10">
            <span>© {new Date().getFullYear()} {t.footerCopyright}</span>
            <span>{t.footerTagline}</span>
          </div>
        </div>
      </footer>
    </main>
  );
}
