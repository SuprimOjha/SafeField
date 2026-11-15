"use client";

import React, { useEffect, useMemo, useState } from "react";
import { BookOpen, Droplets, Sprout, Trash2, CloudRain } from "lucide-react";
import type { RainfallObservation } from "@/types/safefield";
import { getDict, type Lang } from "@/i18n";

type LogKind = "irrigation" | "rain" | "planting" | "field_note";
type CropSetup = {
  crop: string;
  variety: string;
  establishment: "transplanting" | "direct_seeding";
  plantingDate: string;
};
type FarmerLog = {
  id: string;
  kind: LogKind;
  date: string;
  amount: string;
  note: string;
};

const EMPTY_SETUP: CropSetup = {
  crop: "rice",
  variety: "",
  establishment: "transplanting",
  plantingDate: "",
};

function storageKey(lat: number, lon: number) {
  return `safefield_farmer_records_${lat.toFixed(2)}_${lon.toFixed(2)}`;
}

export default function FarmerLogbook({
  lang,
  rainfall,
  latitude,
  longitude,
}: {
  lang: Lang;
  rainfall: RainfallObservation | null;
  latitude: number;
  longitude: number;
}) {
  const t = getDict(lang);
  const key = useMemo(() => storageKey(latitude, longitude), [latitude, longitude]);
  const [setup, setSetup] = useState<CropSetup>(EMPTY_SETUP);
  const [logs, setLogs] = useState<FarmerLog[]>([]);
  const [kind, setKind] = useState<LogKind>("irrigation");
  const [date, setDate] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let restoredSetup = EMPTY_SETUP;
    let restoredLogs: FarmerLog[] = [];
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw) as { setup?: CropSetup; logs?: FarmerLog[] };
        restoredSetup = parsed.setup && typeof parsed.setup === "object"
          ? { ...EMPTY_SETUP, ...parsed.setup }
          : EMPTY_SETUP;
        restoredLogs = Array.isArray(parsed.logs) ? parsed.logs.filter((item) =>
          item && typeof item.id === "string" &&
          ["irrigation", "rain", "planting", "field_note"].includes(item.kind) &&
          typeof item.date === "string" && typeof item.amount === "string" && typeof item.note === "string"
        ) : [];
      }
    } catch {
      restoredSetup = EMPTY_SETUP;
      restoredLogs = [];
    }
    // Defer state updates until after the effect body; guard against a fast field switch.
    Promise.resolve().then(() => {
      if (cancelled) return;
      setSetup(restoredSetup);
      setLogs(restoredLogs);
      setLoadedKey(key);
    });
    return () => { cancelled = true; };
  }, [key]);

  useEffect(() => {
    if (loadedKey !== key) return;
    try {
      window.localStorage.setItem(key, JSON.stringify({ setup, logs }));
    } catch {
      // Keep this field log usable in memory if browser storage is unavailable.
    }
  }, [key, setup, logs, loadedKey]);

  function addLog(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!date) return;
    const entry: FarmerLog = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind,
      date,
      amount: amount.trim(),
      note: note.trim(),
    };
    setLogs((current) => [entry, ...current].slice(0, 100));
    setAmount("");
    setNote("");
  }

  const rainfallLabel = rainfall?.status === "AVAILABLE" && rainfall.amount_mm !== null
    ? `${rainfall.amount_mm} mm`
    : t.farmerRainUnavailable;
  const rainfallSource = rainfall?.provenance
    ? `${rainfall.provenance.source_name} · ${rainfall.provenance.kind} · ${rainfall.provenance.observed_start_utc.slice(0, 10)} – ${rainfall.provenance.observed_end_utc.slice(0, 10)}`
    : t.farmerRainNoSource;
  const irrigationCount = logs.filter((item) => item.kind === "irrigation").length;
  const farmerRainCount = logs.filter((item) => item.kind === "rain").length;

  const kindLabel: Record<LogKind, string> = {
    irrigation: t.farmerLogIrrigation,
    rain: t.farmerLogRain,
    planting: t.farmerLogPlanting,
    field_note: t.farmerLogNote,
  };

  return (
    <section className="space-y-5 rounded-xl border border-divider bg-white p-4 shadow-float sm:p-6" aria-labelledby="farmer-logbook-title">
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-action-soft text-forest"><BookOpen className="h-5 w-5" /></span>
        <div>
          <h3 id="farmer-logbook-title" className="text-lg font-extrabold text-forest">{t.farmerLogbookTitle}</h3>
          <p className="mt-1 text-sm leading-5 text-ink-soft">{t.farmerLogbookIntro}</p>
        </div>
      </div>

      <div className="rounded-lg border border-divider bg-soft p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-bold text-forest"><Sprout className="h-4 w-4" />{t.farmerCropSetup}</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs font-semibold text-ink-soft">
            {t.farmerCrop}
            <select value={setup.crop} onChange={(e) => setSetup((s) => ({ ...s, crop: e.target.value }))} className="mt-1.5 min-h-11 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink">
              <option value="rice">{t.farmerCropRice}</option>
              <option value="maize">{t.farmerCropMaize}</option>
              <option value="wheat">{t.farmerCropWheat}</option>
              <option value="vegetables">{t.farmerCropVegetables}</option>
              <option value="other">{t.farmerCropOther}</option>
            </select>
          </label>
          <label className="block text-xs font-semibold text-ink-soft">
            {t.farmerVariety}
            <input value={setup.variety} onChange={(e) => setSetup((s) => ({ ...s, variety: e.target.value }))} maxLength={80} placeholder={t.farmerVarietyPlaceholder} className="mt-1.5 min-h-11 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink" />
          </label>
          <label className="block text-xs font-semibold text-ink-soft">
            {t.farmerEstablishment}
            <select value={setup.establishment} onChange={(e) => setSetup((s) => ({ ...s, establishment: e.target.value as CropSetup["establishment"] }))} className="mt-1.5 min-h-11 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink">
              <option value="transplanting">{t.farmerTransplanting}</option>
              <option value="direct_seeding">{t.farmerDirectSeeding}</option>
            </select>
          </label>
          <label className="block text-xs font-semibold text-ink-soft">
            {t.farmerPlantingDate}
            <input type="date" value={setup.plantingDate} onChange={(e) => setSetup((s) => ({ ...s, plantingDate: e.target.value }))} className="mt-1.5 min-h-11 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink" />
          </label>
        </div>
        <p className="mt-3 text-xs leading-5 text-ink-muted">{t.farmerLocalOnly}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-info/30 bg-info-soft p-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-info"><CloudRain className="h-4 w-4" />{t.farmerRainImpact}</div>
          <p className="mt-2 text-2xl font-extrabold text-ink">{rainfallLabel}</p>
          <p className="mt-1 text-xs leading-5 text-ink-soft">{rainfallSource}</p>
        </div>
        <div className="rounded-lg border border-divider bg-soft p-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-ink-soft"><Droplets className="h-4 w-4" />{t.farmerIrrigationEntries}</div>
          <p className="mt-2 text-2xl font-extrabold text-ink">{irrigationCount}</p>
          <p className="mt-1 text-xs text-ink-muted">{t.farmerManualCountOnly}</p>
        </div>
        <div className="rounded-lg border border-divider bg-soft p-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-ink-soft"><CloudRain className="h-4 w-4" />{t.farmerRainEntries}</div>
          <p className="mt-2 text-2xl font-extrabold text-ink">{farmerRainCount}</p>
          <p className="mt-1 text-xs text-ink-muted">{t.farmerManualCountOnly}</p>
        </div>
      </div>

      <div className="rounded-lg border border-divider p-4">
        <h4 className="mb-3 text-sm font-bold text-forest">{t.farmerAddLog}</h4>
        <form onSubmit={addLog} className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs font-semibold text-ink-soft">
            {t.farmerLogType}
            <select value={kind} onChange={(e) => setKind(e.target.value as LogKind)} className="mt-1.5 min-h-11 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink">
              <option value="irrigation">{t.farmerLogIrrigation}</option>
              <option value="rain">{t.farmerLogRain}</option>
              <option value="planting">{t.farmerLogPlanting}</option>
              <option value="field_note">{t.farmerLogNote}</option>
            </select>
          </label>
          <label className="block text-xs font-semibold text-ink-soft">
            {t.farmerLogDate}
            <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className="mt-1.5 min-h-11 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink" />
          </label>
          <label className="block text-xs font-semibold text-ink-soft">
            {kind === "rain" ? t.farmerRainAmount : kind === "irrigation" ? t.farmerWaterAmount : t.farmerOptionalAmount}
            <input type="number" min="0" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={kind === "rain" ? "mm" : kind === "irrigation" ? t.farmerWaterUnit : ""} className="mt-1.5 min-h-11 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink" />
          </label>
          <label className="block text-xs font-semibold text-ink-soft">
            {t.farmerLogNoteLabel}
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={240} placeholder={t.farmerLogNotePlaceholder} className="mt-1.5 min-h-11 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink" />
          </label>
          <div className="sm:col-span-2">
            <button type="submit" disabled={!date} className="inline-flex min-h-11 items-center justify-center rounded-full bg-action px-5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">{t.farmerSaveLog}</button>
          </div>
        </form>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <h4 className="text-sm font-bold text-forest">{t.farmerRecentLogs}</h4>
          <span className="text-xs text-ink-muted">{logs.length} / 100</span>
        </div>
        {logs.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line bg-soft p-4 text-sm text-ink-muted">{t.farmerNoLogs}</p>
        ) : (
          <ul className="space-y-2">
            {logs.map((item) => (
              <li key={item.id} className="flex items-start justify-between gap-3 rounded-lg border border-divider p-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-ink">{kindLabel[item.kind]} <span className="ml-1 font-normal text-ink-muted">{item.date}</span></p>
                  {item.amount && <p className="mt-1 text-xs font-semibold text-forest">{item.amount} {item.kind === "rain" ? "mm" : item.kind === "irrigation" ? t.farmerWaterUnit : ""}</p>}
                  {item.note && <p className="mt-1 break-words text-sm text-ink-soft">{item.note}</p>}
                  <p className="mt-1 text-[11px] text-ink-muted">{t.farmerEntryIsInput}</p>
                </div>
                <button type="button" onClick={() => setLogs((current) => current.filter((entry) => entry.id !== item.id))} aria-label={t.farmerDeleteLog} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-danger hover:bg-danger-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"><Trash2 className="h-4 w-4" /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="rounded-lg border border-amber bg-amber-soft p-3 text-xs leading-5 text-amber-ink">{t.farmerRainCaveat}</p>
    </section>
  );
}
