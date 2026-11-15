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
import ScreenFIrrigation from "@/components/ScreenFIrrigation";
import AskAssistant from "@/components/AskAssistant";
import ScreenAskHub from "@/components/ScreenAskHub";
import {
  Droplets,
  Ellipsis,
  Home,
  MapPinned,
  TrendingUp,
  WifiOff,
  MessageCircleQuestion,
  Sprout,
} from "lucide-react";
import { getDict, type Lang } from "@/i18n";

type TabId = "home" | "field" | "irrigation" | "decision" | "trends" | "ask" | "methods";

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
  { id: "home", labelEn: "Today", shortEn: "Today", labelNe: "आज", shortNe: "आज", icon: Home },
  { id: "field", labelEn: "My field", shortEn: "Field", labelNe: "मेरो खेत", shortNe: "खेत", icon: MapPinned },
  { id: "irrigation", labelEn: "Irrigation", shortEn: "Water", labelNe: "सिँचाइ", shortNe: "सिँचाइ", icon: Droplets },
  { id: "trends", labelEn: "Climate trends", shortEn: "Trends", labelNe: "जलवायु प्रवृत्ति", shortNe: "प्रवृत्ति", icon: TrendingUp },
  { id: "ask", labelEn: "Ask", shortEn: "Ask", labelNe: "सोध्नुहोस्", shortNe: "सोध", icon: MessageCircleQuestion },
  { id: "methods", labelEn: "More", shortEn: "More", labelNe: "थप", shortNe: "थप", icon: Ellipsis },
] as const;

const SESSION_KEY = "safefield_session";

type PersistedSession = {
  hasField: boolean;
  lat: number | null;
  lon: number | null;
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
        // Sessions saved before the field-first flow have no `hasField` flag,
        // so they must not restore a field the farmer never chose again.
        const hasField = parsed.hasField === true;
        sessionValueCache = {
          hasField,
          lat: hasField ? parsed.lat : null,
          lon: hasField ? parsed.lon : null,
          fertilizerType: parsed.fertilizerType,
          cropStage: parsed.cropStage,
          sandPercentOverride: typeof parsed.sandPercentOverride === "number" ? parsed.sandPercentOverride : null,
          polygon: hasField && Array.isArray(parsed.polygon) ? parsed.polygon : null,
          assessment: hasField && parsed.assessment && typeof parsed.assessment === "object" ? parsed.assessment : null,
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

/** Compact two-state language switch: English (EN) / Nepali (ने). */
function LanguageToggle({ lang, setLang }: { lang: Lang; setLang: (next: Lang) => void }) {
  return (
    <div
      role="group"
      aria-label={lang === "en" ? "Language selection" : "भाषा छनोट"}
      className="inline-flex min-h-10 items-center rounded-full border border-line bg-white p-1"
    >
      <button
        type="button"
        onClick={() => setLang("en")}
        aria-pressed={lang === "en"}
        aria-label="English"
        title="English"
        className={`inline-flex h-8 min-w-8 items-center justify-center rounded-full px-2 text-[11px] font-bold transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action ${
          lang === "en" ? "bg-brand-blue-deep text-white shadow-card" : "text-ink-soft hover:bg-soft"
        }`}
      >
        EN
      </button>
      <button
        type="button"
        onClick={() => setLang("ne")}
        aria-pressed={lang === "ne"}
        aria-label="नेपाली"
        title="नेपाली"
        className={`inline-flex h-8 min-w-8 items-center justify-center rounded-full px-2 text-[11px] font-bold transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action ${
          lang === "ne" ? "bg-brand-blue-deep text-white shadow-card" : "text-ink-soft hover:bg-soft"
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
  const [hasFieldState, setHasFieldState] = useState<boolean | null>(null);
  const [fertilizerState, setFertilizerState] = useState<string | null>(null);
  const [cropState, setCropState] = useState<string | null>(null);
  const [sandState, setSandState] = useState<number | null | undefined>(undefined);
  const [polygonState, setPolygonState] = useState<[number, number][] | null | undefined>(undefined);
  const [assessmentState, setAssessmentState] = useState<FieldAssessmentResponse | null | undefined>(undefined);
  // Previous assessment for the Ask assistant what_changed intent. It only
  // changes when a NEW assessment successfully replaces the old one, so a
  // failed refresh never corrupts the comparison (honest answer, rule 1).
  const [previousAssessmentState, setPreviousAssessmentState] = useState<FieldAssessmentResponse | null>(null);

  // No field is selected until the farmer marks one on the map, uses GPS, or
  // walks the boundary. Weather, assessment and Ask stay gated behind this.
  const hasField = hasFieldState ?? persisted?.hasField ?? false;
  const selectedLat = hasField ? (latState ?? persisted?.lat ?? null) : null;
  const selectedLon = hasField ? (lonState ?? persisted?.lon ?? null) : null;
  const fertilizerType = fertilizerState ?? persisted?.fertilizerType ?? "Urea";
  const cropStage = cropState ?? persisted?.cropStage ?? "Vegetative / Tillering";
  const sandPercentOverride = sandState === undefined ? (persisted?.sandPercentOverride ?? null) : sandState;
  const selectedFieldPolygon = polygonState === undefined ? (persisted?.polygon ?? null) : polygonState;
  const assessmentData = hasField ? (assessmentState === undefined ? (persisted?.assessment ?? null) : assessmentState) : null;

  const [assessmentError, setAssessmentError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [, startTransition] = useTransition();

  // Session persistence is interaction-driven: localStorage is only written
  // when the user actually changes something, so the stored session is never
  // clobbered by default values during hydration.
  const effectiveRef = useRef<PersistedSession>({
    hasField: false,
    lat: null,
    lon: null,
    fertilizerType: "Urea",
    cropStage: "Vegetative / Tillering",
    sandPercentOverride: null,
    polygon: null,
    assessment: null,
  });

  // Keep the mirror in sync with the latest effective values after each render.
  useEffect(() => {
    effectiveRef.current = {
      hasField,
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
    setHasFieldState(true);
    setPolygonState(null);
    // A stored assessment belongs to the previous field; clear it so the new
    // location never shows another field's numbers.
    setAssessmentState(null);
    setAssessmentError(null);
    updateSession({ hasField: true, lat, lon, polygon: null, assessment: null });
  }, [updateSession]);

  const handlePolygonChange = useCallback((polygon: [number, number][] | null) => {
    setPolygonState(polygon);
    updateSession({ polygon });
  }, [updateSession]);

  // Browser-tab title follows the active screen; the home tab shows the
  // plain app name ("Safe Field Nepal").
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

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
    if (!hasField || selectedLat === null || selectedLon === null) return;
    const requestId = ++requestSequence.current;
    const outgoing = assessmentData;
    setLoading(true);
    setAssessmentError(null);
    setAssessmentState(null);
    try {
      // Keep the precise field polygon on this device. The API receives only
      // rounded representative coordinates; no field geometry is transmitted.
      const data = await fetchFieldAssessment(
        Number(selectedLat.toFixed(2)),
        Number(selectedLon.toFixed(2)),
        fertilizerType,
        cropStage,
        true,
        sandPercentOverride,
        null,
      );
      if (requestId === requestSequence.current) {
        startTransition(() => {
          setPreviousAssessmentState(outgoing);
          setAssessmentState(data);
        });
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
  }, [hasField, selectedLat, selectedLon, fertilizerType, cropStage, sandPercentOverride, assessmentData, startTransition, updateSession]);

  const handleRunAssessment = useCallback(() => {
    void refreshAssessment();
  }, [refreshAssessment]);

  // Assessment is intentionally started by the explicit action on the home
  // dashboard, after the user has selected the final point or drawn boundary.
  // This prevents an early/default-location request from racing it.
  const selectTab = (tab: TabId) => {
    setActiveTab(tab);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Used by the no-field CTAs on My field, Ask and the assistant: go to the
  // home map and open its location tools.
  const handleSelectField = useCallback(() => {
    setActiveTab("home");
    window.scrollTo({ top: 0, behavior: "smooth" });
    window.setTimeout(() => window.dispatchEvent(new Event("safefield-focus-field")), 120);
  }, []);

  return (
    <main id="main-content" tabIndex={-1} className="flex min-h-screen flex-col bg-canvas text-ink">
      <a href="#main-content" className="sr-only z-[100] rounded-full bg-white px-4 py-3 font-semibold text-brand-blue-deep focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:shadow-float focus:ring-2 focus:ring-brand-blue">Skip to main content</a>
      {!isOnline && (
        <div role="status" aria-live="polite" className="flex items-center justify-center gap-2 border-b border-warning bg-warning-soft px-4 py-2.5 text-center text-xs font-semibold text-amber-ink">
          <WifiOff className="h-4 w-4 shrink-0" />
          <span>{t.offlineBanner}</span>
        </div>
      )}

      <div className="flex w-full flex-1">
        {/* Compact icon rail (desktop), matching the dashboard reference */}
        <aside className="sticky top-0 hidden h-screen w-[84px] shrink-0 flex-col items-center border-r border-divider bg-white py-5 lg:flex">
          <button
            type="button"
            onClick={() => selectTab("home")}
            className="group flex h-11 w-11 items-center justify-center rounded-[14px] bg-gradient-growth text-[#102A18] shadow-card outline-none transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2"
            aria-label="Safe Field Nepal home"
            title="Safe Field Nepal"
          >
            <Sprout className="h-6 w-6" aria-hidden="true" />
          </button>

          <nav aria-label="Main navigation" className="mt-7 flex flex-1 flex-col items-center gap-2">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              const label = lang === "ne" ? item.labelNe : item.labelEn;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => selectTab(item.id)}
                  aria-current={isActive ? "page" : undefined}
                  aria-label={label}
                  title={label}
                  className={`relative flex h-11 w-11 items-center justify-center rounded-2xl transition active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action ${
                    isActive
                      ? "bg-brand-blue-soft text-brand-blue-deep"
                      : "text-ink-muted hover:bg-soft hover:text-ink"
                  }`}
                >
                  {isActive && <span className="absolute -left-[13px] h-5 w-1 rounded-full bg-brand-blue-deep" aria-hidden="true" />}
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </button>
              );
            })}
          </nav>

          <div className="border-t border-divider pt-4">
            <LanguageToggle lang={lang} setLang={setLang} />
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Mobile top header — light glass over scrolling content */}
          <header className="glass-topbar sticky top-0 z-50 lg:hidden">
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

          <section className="flex w-full flex-1 flex-col px-3 pb-44 pt-5 sm:px-6 sm:pb-32 sm:pt-7 lg:px-8 lg:pb-24 lg:pt-7">
            {activeTab === "home" && (
              <ScreenAHome
                selectedLat={selectedLat}
                selectedLon={selectedLon}
                hasField={hasField}
                data={assessmentData}
                loading={loading}
                error={assessmentError}
                onLocationSelect={handleLocationChange}
                onFieldPolygonSelect={handlePolygonChange}
                onSandOverrideChange={handleSandOverrideChange}
                fieldPolygon={selectedFieldPolygon}
                onRunAssessment={handleRunAssessment}
                onOpenField={() => selectTab("field")}
                lang={lang}
              />
            )}

            {activeTab === "field" && (
              <ScreenBField
                hasField={hasField}
                onSelectField={handleSelectField}
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

            {activeTab === "irrigation" && (
              <ScreenFIrrigation
                hasField={hasField}
                onSelectField={handleSelectField}
                data={assessmentData}
                loading={loading}
                error={assessmentError}
                onRunAssessment={handleRunAssessment}
                lang={lang}
              />
            )}

            {activeTab === "decision" && (              <ScreenCDecision
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

            {activeTab === "ask" && (
              <ScreenAskHub hasField={hasField} onSelectField={handleSelectField} lang={lang} />
            )}

            {activeTab === "methods" && <ScreenEMethods data={assessmentData} lang={lang} />}
          </section>
        </div>
      </div>

        {/* Floating bottom navigation capsule — white liquid glass with blue
            active states, per the Blue Horizon mobile spec */}
      <nav
        aria-label="Mobile navigation"
        className="fixed inset-x-0 bottom-0 z-[60] flex justify-center px-4 pb-[max(env(safe-area-inset-bottom),12px)] lg:hidden"
      >
        <div className="glass-bottomnav shadow-float grid w-full max-w-md grid-cols-6 gap-0.5 rounded-2xl p-1.5">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => selectTab(item.id)}
                aria-current={isActive ? "page" : undefined}
                className={`flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-full px-1 py-1.5 text-[11px] leading-tight font-semibold transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action ${
                  isActive ? "text-brand-blue-deep" : "text-ink-muted hover:text-ink"
                }`}
              >
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-full transition ${
                    isActive ? "bg-brand-blue-soft text-brand-blue-deep" : "text-ink-muted"
                  }`}
                >
                  <Icon className="h-[17px] w-[17px]" aria-hidden="true" />
                </span>
                <span className="max-w-full truncate px-0.5">{lang === "ne" ? item.shortNe : item.shortEn}</span>
              </button>
            );
          })}
        </div>
      </nav>

      <AskAssistant
        lang={lang}
        hasField={hasField}
        onSelectField={handleSelectField}
        context={{
          latitude: selectedLat ?? 0,
          longitude: selectedLon ?? 0,
          answers: { fertilizerType, cropStage, saveMoney: true, sandPercentOverride },
          assessment: assessmentData,
          previousAssessment: previousAssessmentState,
          farmerContent: null,
        }}
      />
    </main>
  );
}
