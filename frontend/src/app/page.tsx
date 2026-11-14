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
  Satellite,
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

const SESSION_KEY = "safefield_session";

type PersistedSession = {
  lat: number;
  lon: number;
  fertilizerType: string;
  cropStage: string;
  sandPercentOverride: number | null;
  polygon: [number, number][] | null;
  assessment: FieldAssessmentResponse | null;
};

function subscribeToSession(onChange: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener("storage", onChange);
  };
}

// Cached snapshot reader: useSyncExternalStore requires a stable reference
// between renders, so the parsed session is memoized by the raw string.
let sessionRawCache: string | null | undefined;
let sessionValueCache: PersistedSession | null;

function getSessionSnapshot(): PersistedSession | null {
  if (typeof window === "undefined") return null;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(SESSION_KEY);
  } catch {
    raw = null;
  }
  if (sessionRawCache !== undefined && raw === sessionRawCache) return sessionValueCache ?? null;
  sessionRawCache = raw;
  sessionValueCache = null;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<PersistedSession>;
      if (
        typeof parsed.lat === "number" &&
        typeof parsed.lon === "number" &&
        typeof parsed.fertilizerType === "string" &&
        typeof parsed.cropStage === "string"
      ) {
        sessionValueCache = {
          lat: parsed.lat,
          lon: parsed.lon,
          fertilizerType: parsed.fertilizerType,
          cropStage: parsed.cropStage,
          sandPercentOverride: typeof parsed.sandPercentOverride === "number" ? parsed.sandPercentOverride : null,
          polygon: Array.isArray(parsed.polygon) ? parsed.polygon : null,
          assessment: parsed.assessment && typeof parsed.assessment === "object" ? parsed.assessment : null,
        };
      }
    } catch {
      sessionValueCache = null;
    }
  }
  return sessionValueCache;
}

function getServerSessionSnapshot(): PersistedSession | null {
  return null;
}

function LanguageToggle({ lang, setLang }: { lang: Lang; setLang: (next: Lang) => void }) {
  return (
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
  );
}

export default function SafeFieldNepalApp() {
  const [activeTab, setActiveTab] = useState<TabId>("home");
  const lang = useSyncExternalStore(subscribeToLanguage, getLanguageSnapshot, getServerLanguageSnapshot);
  const t = getDict(lang);
  const setLang = useCallback((next: Lang) => updateStoredLanguage(next), []);
  const requestSequence = useRef(0);

  const isOnline = useSyncExternalStore(subscribeToOnlineStatus, getOnlineStatus, getServerOnlineStatus);

  // Persisted session (restored via useSyncExternalStore, following the same
  // hydration-safe pattern as the language setting). Each `*State` holds the
  // value chosen during this visit; when untouched the persisted value wins.
  const persisted = useSyncExternalStore(subscribeToSession, getSessionSnapshot, getServerSessionSnapshot);

  const [latState, setLatState] = useState<number | null>(null);
  const [lonState, setLonState] = useState<number | null>(null);
  const [fertilizerState, setFertilizerState] = useState<string | null>(null);
  const [cropState, setCropState] = useState<string | null>(null);
  const [sandState, setSandState] = useState<number | null | undefined>(undefined);
  const [polygonState, setPolygonState] = useState<[number, number][] | null | undefined>(undefined);
  const [assessmentState, setAssessmentState] = useState<FieldAssessmentResponse | null | undefined>(undefined);

  const selectedLat = latState ?? persisted?.lat ?? 26.45;
  const selectedLon = lonState ?? persisted?.lon ?? 87.28;
  const fertilizerType = fertilizerState ?? persisted?.fertilizerType ?? "Urea";
  const cropStage = cropState ?? persisted?.cropStage ?? "Vegetative / Tillering";
  const sandPercentOverride = sandState === undefined ? (persisted?.sandPercentOverride ?? null) : sandState;
  const selectedFieldPolygon = polygonState === undefined ? (persisted?.polygon ?? null) : polygonState;
  const assessmentData = assessmentState === undefined ? (persisted?.assessment ?? null) : assessmentState;

  const [assessmentError, setAssessmentError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [, startTransition] = useTransition();

  // Session persistence is interaction-driven: localStorage is only written
  // when the user actually changes something, so the stored session is never
  // clobbered by default values during hydration.
  const effectiveRef = useRef<PersistedSession>({
    lat: 26.45,
    lon: 87.28,
    fertilizerType: "Urea",
    cropStage: "Vegetative / Tillering",
    sandPercentOverride: null,
    polygon: null,
    assessment: null,
  });

  // Keep the mirror in sync with the latest effective values after each render.
  useEffect(() => {
    effectiveRef.current = {
      lat: selectedLat,
      lon: selectedLon,
      fertilizerType,
      cropStage,
      sandPercentOverride,
      polygon: selectedFieldPolygon,
      assessment: assessmentData ?? effectiveRef.current.assessment,
    };
  });

  const updateSession = useCallback((patch: Partial<PersistedSession>) => {
    effectiveRef.current = { ...effectiveRef.current, ...patch };
    try {
      window.localStorage.setItem(SESSION_KEY, JSON.stringify(effectiveRef.current));
    } catch {
      // Storage may be unavailable or full; the app still works in memory.
    }
  }, []);

  const handleFertilizerChange = useCallback((value: string) => {
    setFertilizerState(value);
    updateSession({ fertilizerType: value });
  }, [updateSession]);

  const handleCropStageChange = useCallback((value: string) => {
    setCropState(value);
    updateSession({ cropStage: value });
  }, [updateSession]);

  const handleSandOverrideChange = useCallback((value: number | null) => {
    setSandState(value);
    updateSession({ sandPercentOverride: value });
  }, [updateSession]);

  const handleLocationChange = useCallback((lat: number, lon: number) => {
    setLatState(lat);
    setLonState(lon);
    setPolygonState(null);
    updateSession({ lat, lon, polygon: null });
  }, [updateSession]);

  const handlePolygonChange = useCallback((polygon: [number, number][] | null) => {
    setPolygonState(polygon);
    updateSession({ polygon });
  }, [updateSession]);

  // Browser-tab title follows the active screen; the home tab shows the
  // plain app name ("Safe Field Nepal").
  useEffect(() => {
    const item = NAV_ITEMS.find((entry) => entry.id === activeTab);
    const label = lang === "ne" ? item?.labelNe : item?.labelEn;
    document.title = activeTab === "home" || !label
      ? "Safe Field Nepal"
      : `${label} - Safe Field Nepal`;
  }, [activeTab, lang]);

  // Fetching starts after the effect runs; state updates happen only after the
  // asynchronous request settles, avoiding synchronous state updates in effects.
  const refreshAssessment = useCallback(async () => {
    const requestId = ++requestSequence.current;
    setLoading(true);
    setAssessmentError(null);
    setAssessmentState(null);
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
      if (requestId === requestSequence.current) {
        startTransition(() => setAssessmentState(data));
        updateSession({ assessment: data });
      }
    } catch (err) {
      if (requestId === requestSequence.current) {
        const message = err instanceof Error ? err.message : "Unknown error while loading the field assessment.";
        setAssessmentError(message);
        console.error("Failed to fetch field assessment:", err);
      }
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, [selectedLat, selectedLon, fertilizerType, cropStage, sandPercentOverride, selectedFieldPolygon, startTransition, updateSession]);

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
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <main id="main-content" tabIndex={-1} className="flex min-h-screen flex-col bg-[#f5f8f4] text-[#183326]">
      <a href="#main-content" className="sr-only z-[100] rounded-lg bg-white px-4 py-3 font-bold text-emerald-900 focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:ring-2 focus:ring-emerald-700">Skip to main content</a>
      {!isOnline && (
        <div className="bg-rose-800 px-4 py-2.5 text-center text-xs font-semibold text-white flex items-center justify-center gap-2">
          <WifiOff className="h-4 w-4 shrink-0" />
          <span>{t.offlineBanner}</span>
        </div>
      )}

      <div className="flex w-full flex-1">
        {/* Left sidebar navigation (desktop) */}
        <aside className="sticky top-0 hidden h-screen w-[260px] shrink-0 flex-col border-r border-emerald-950/10 bg-white shadow-[4px_0_24px_rgba(15,55,35,0.05)] lg:flex">
          <button
            type="button"
            onClick={() => selectTab("home")}
            className="group flex items-center gap-2.5 px-5 pb-4 pt-6 text-left outline-none transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2"
            aria-label="Safe Field Nepal home"
          >
            <Satellite className="h-9 w-9 shrink-0 text-emerald-700" aria-hidden="true" />
            <span className="flex min-w-0 flex-col">
              <span className="text-lg font-extrabold tracking-tight text-emerald-900">Safe Field</span>
              <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-emerald-600">{t.brandTagline}</span>
            </span>
          </button>

          <nav aria-label="Main navigation" className="flex flex-1 flex-col gap-1 px-3 py-2">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => selectTab(item.id)}
                  aria-current={isActive ? "page" : undefined}
                  className={`flex min-h-[46px] items-center gap-3 rounded-xl px-3.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 ${
                    isActive
                      ? "bg-emerald-50 text-emerald-900 shadow-[inset_0_0_0_1px_rgba(2,102,61,0.14)]"
                      : "text-slate-500 hover:bg-emerald-50/70 hover:text-emerald-800"
                  }`}
                >
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${isActive ? "bg-emerald-700 text-white shadow-sm" : "bg-slate-100 text-slate-500"}`}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="truncate">{lang === "ne" ? item.labelNe : item.labelEn}</span>
                  {isActive && <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-emerald-600" aria-hidden="true" />}
                </button>
              );
            })}
          </nav>

          <div className="border-t border-slate-100 px-5 py-4">
            <LanguageToggle lang={lang} setLang={setLang} />
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Mobile top header */}
          <header className="sticky top-0 z-50 border-b border-emerald-950/10 bg-white/95 shadow-[0_8px_30px_rgba(15,55,35,0.07)] backdrop-blur-xl lg:hidden">
            <div className="flex min-h-[68px] items-center justify-between gap-3 px-4">
              <button
                type="button"
                onClick={() => selectTab("home")}
                className="group flex min-w-0 items-center gap-2.5 rounded-2xl text-left outline-none transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2"
                aria-label="Safe Field Nepal home"
              >
                <Satellite className="h-8 w-8 shrink-0 text-emerald-700" aria-hidden="true" />
                <span className="flex min-w-0 flex-col">
                  <span className="text-base font-extrabold tracking-tight text-emerald-900">Safe Field</span>
                  <span className="truncate text-[8px] font-bold uppercase tracking-[0.12em] text-emerald-600">{t.brandTagline}</span>
                </span>
              </button>
              <div className="shrink-0">
                <LanguageToggle lang={lang} setLang={setLang} />
              </div>
            </div>
          </header>

          <section className="flex w-full flex-1 flex-col px-3 py-5 pb-28 sm:px-6 sm:py-7 lg:px-8 lg:py-8 lg:pb-8">
            {activeTab === "home" && (
              <ScreenAHome
                selectedLat={selectedLat}
                selectedLon={selectedLon}
                onLocationSelect={handleLocationChange}
                onFieldPolygonSelect={handlePolygonChange}
                fieldPolygon={selectedFieldPolygon}
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
                setFertilizerType={handleFertilizerChange}
                cropStage={cropStage}
                setCropStage={handleCropStageChange}
                sandPercentOverride={sandPercentOverride}
                onSandOverrideChange={handleSandOverrideChange}
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
                      <button type="button" onClick={() => selectTab(item.id)} className="transition hover:text-white focus-visible:outline-none focus-visible:underline">
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
        </div>
      </div>

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
    </main>
  );
}
