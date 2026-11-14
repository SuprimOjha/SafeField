"use client";

import React, { useCallback, useEffect, useState, useSyncExternalStore, useTransition, useRef } from "react";
import Image from "next/image";
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
      className="inline-flex min-h-10 items-center rounded-full border border-line bg-white p-1"
    >
      <Globe2 className="mx-1.5 h-4 w-4 text-ink-soft" aria-hidden="true" />
      <button
        type="button"
        onClick={() => setLang("en")}
        aria-pressed={lang === "en"}
        className={`rounded-full px-3 py-1.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action ${
          lang === "en" ? "bg-forest text-white" : "text-ink-soft hover:text-ink"
        }`}
      >
        EN
      </button>
      <button
        type="button"
        onClick={() => setLang("ne")}
        aria-pressed={lang === "ne"}
        className={`rounded-full px-3 py-1.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action ${
          lang === "ne" ? "bg-forest text-white" : "text-ink-soft hover:text-ink"
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
    <main id="main-content" tabIndex={-1} className="flex min-h-screen flex-col bg-warm text-ink">
      <a href="#main-content" className="sr-only z-[100] rounded-full bg-white px-4 py-3 font-semibold text-forest focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:shadow-float focus:ring-2 focus:ring-action">Skip to main content</a>
      {!isOnline && (
        <div className="flex items-center justify-center gap-2 bg-danger px-4 py-2.5 text-center text-xs font-semibold text-white">
          <WifiOff className="h-4 w-4 shrink-0" />
          <span>{t.offlineBanner}</span>
        </div>
      )}

      <div className="flex w-full flex-1">
        {/* Left sidebar navigation (desktop) */}
        <aside className="sticky top-0 hidden h-screen w-[248px] shrink-0 flex-col border-r border-divider bg-white lg:flex">
          <button
            type="button"
            onClick={() => selectTab("home")}
            className="group flex px-5 pb-4 pt-6 text-left outline-none transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2"
            aria-label="Safe Field Nepal home"
          >
            <Image
              src="/logo.png"
              alt="Safe Field"
              className="h-11 w-auto max-w-full object-contain object-left"
              width={544}
              height={160}
              priority
            />
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
                  className={`flex min-h-[46px] items-center gap-3 rounded-md px-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action ${
                    isActive
                      ? "bg-mint text-forest shadow-[inset_0_0_0_2px_var(--color-leaf)]"
                      : "text-ink-soft hover:bg-canvas hover:text-ink"
                  }`}
                >
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${isActive ? "bg-action text-white" : "bg-soft text-ink-muted"}`}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="truncate">{lang === "ne" ? item.labelNe : item.labelEn}</span>
                </button>
              );
            })}
          </nav>

          <div className="border-t border-divider px-5 py-4">
            <LanguageToggle lang={lang} setLang={setLang} />
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Mobile top header */}
          <header className="sticky top-0 z-50 border-b border-divider bg-white/95 backdrop-blur-xl lg:hidden">
            <div className="flex min-h-[64px] items-center justify-between gap-3 px-4">
              <button
                type="button"
                onClick={() => selectTab("home")}
                className="group flex min-w-0 items-center rounded-xl text-left outline-none transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2"
                aria-label="Safe Field Nepal home"
              >
                <Image
                  src="/logo.png"
                  alt="Safe Field"
                  className="h-9 w-auto max-w-full object-contain object-left"
                  width={544}
                  height={160}
                />
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
        </div>
      </div>

      <nav
        aria-label="Mobile navigation"
        className="fixed inset-x-0 bottom-0 z-[60] flex justify-center px-4 pb-[max(env(safe-area-inset-bottom),12px)] lg:hidden"
      >
        <div className="grid w-full max-w-md grid-cols-5 gap-0.5 rounded-full bg-charcoal p-1.5 shadow-[0_8px_28px_rgba(24,44,30,0.32)]">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => selectTab(item.id)}
                aria-current={isActive ? "page" : undefined}
                className={`flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-full px-1 py-1.5 text-[9px] font-medium transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action ${
                  isActive ? "text-white" : "text-white/55 hover:text-white"
                }`}
              >
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-full transition ${
                    isActive ? "bg-action text-white" : "text-white/70"
                  }`}
                >
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
