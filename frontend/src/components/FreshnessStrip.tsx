"use client";

import { useEffect, useState } from "react";
import { Clock3, CloudRain } from "lucide-react";
import type { RainfallObservation } from "@/types/safefield";
import { getDict, type Lang } from "@/i18n";

interface FreshnessStripProps { rainfall: RainfallObservation; lang: Lang; }

export default function FreshnessStrip({ rainfall, lang }: FreshnessStripProps) {
  const t = getDict(lang);
  const provenance = rainfall.provenance;
  const isObservation = provenance?.kind === "observation";
  const start = provenance?.observed_start_utc?.slice(0, 10);
  const end = provenance?.observed_end_utc?.slice(0, 10);
  const dateLabel = start && end ? (start === end ? start : start + " – " + end) : null;
  const [ageHours, setAgeHours] = useState<number | null>(null);

  useEffect(() => {
    const observedEnd = provenance?.observed_end_utc;
    const timer = window.setTimeout(() => {
      const validEnd = observedEnd ? Date.parse(observedEnd) : Number.NaN;
      setAgeHours(Number.isFinite(validEnd)
        ? Math.max(0, Math.round((Date.now() - validEnd) / 3_600_000))
        : null);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [provenance?.observed_end_utc]);
  return <div role="status" className="flex flex-col gap-2 rounded-xl border border-info/30 bg-info-soft px-4 py-3 text-base text-ink sm:flex-row sm:items-start sm:gap-3">
    <div className="flex shrink-0 items-center gap-2 font-bold sm:pt-0.5"><CloudRain aria-hidden="true" className="h-5 w-5 shrink-0 text-info" /><span>{t.rainDataFreshness}</span></div>
    <div className="min-w-0 flex-1 space-y-1">
      {rainfall.status === "AVAILABLE" && provenance && dateLabel
        ? <p>{t.rainDataCovers.replace("{date}", dateLabel)} {ageHours !== null ? t.rainDataAge.replace("{hours}", String(ageHours)) : ""} {isObservation ? t.observedNotForecast : t.dataKindLabel + ": " + provenance.kind + "."}</p>
        : <p>{rainfall.unavailable_reason || t.rainFreshnessUnavailable}</p>}
      {provenance?.latency_note ? <p className="tnum flex flex-wrap items-center gap-1 text-sm text-ink-soft"><Clock3 aria-hidden="true" className="h-4 w-4 shrink-0" />{provenance.latency_note}</p> : null}
    </div>
  </div>;
}
