"use client";

import { useEffect, useState } from "react";
import { Database, X } from "lucide-react";
import type { FieldAssessmentResponse, FreshnessBadgeData } from "@/types/safefield";
import { getDict, type Lang } from "@/i18n";

interface DataReceiptDrawerProps { data: FieldAssessmentResponse; lang: Lang; }

function MetadataRow({ label, value }: { label: string; value: string | number | null | undefined }) {
  return <div className="grid grid-cols-[minmax(7rem,0.8fr)_minmax(0,1.2fr)] gap-3 border-b border-divider py-2 last:border-0">
    <dt className="text-sm text-ink-soft">{label}</dt>
    <dd className="break-words text-sm font-semibold text-ink">{value === null || value === undefined || value === "" ? "—" : String(value)}</dd>
  </div>;
}

function SourceReceipt({ title, source }: { title: string; source: FreshnessBadgeData }) {
  return <section className="rounded-xl border border-divider bg-white p-4">
    <h3 className="mb-2 text-base font-bold text-forest">{title}</h3>
    <dl>
      <MetadataRow label="Dataset" value={source.dataset_name} />
      <MetadataRow label="Source" value={source.source_org} />
      <MetadataRow label="NASA" value={source.is_nasa ? "Yes" : "No"} />
      <MetadataRow label="Status" value={source.status} />
      <MetadataRow label="Latest date" value={source.latest_observation_date} />
      <MetadataRow label="Fetched (UTC)" value={source.fetched_at_utc} />
      <MetadataRow label="Typical latency" value={source.typical_latency} />
      <MetadataRow label="Resolution" value={source.spatial_resolution} />
      <MetadataRow label="Limitations" value={source.caveat} />
    </dl>
    {source.docs_url ? <a href={source.docs_url} target="_blank" rel="noreferrer" className="mt-3 inline-flex min-h-12 items-center font-semibold text-info underline underline-offset-4">Source documentation</a> : null}
  </section>;
}

export default function DataReceiptDrawer({ data, lang }: DataReceiptDrawerProps) {
  const [open, setOpen] = useState(false);
  const t = getDict(lang);
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);
  const rainfall = data.rainfall_observation;
  return <>
    <button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-line bg-white px-5 py-3 text-base font-bold text-forest hover:bg-soft focus-visible:outline-offset-4">
      <Database aria-hidden="true" className="h-5 w-5" />{t.showDataReceipt}
    </button>
    {open && <div className="fixed inset-0 z-[100] flex items-end justify-center bg-charcoal/55 sm:items-center sm:p-5" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="data-receipt-title" className="max-h-[88dvh] w-full max-w-2xl overflow-y-auto rounded-t-2xl border border-divider bg-cream p-5 shadow-sheet sm:rounded-2xl sm:p-6">
        <div className="sticky top-0 z-10 -mx-1 mb-4 flex items-center justify-between gap-3 bg-cream px-1 py-2">
          <div><h2 id="data-receipt-title" className="text-xl font-extrabold text-ink">{t.dataReceiptTitle}</h2><p className="text-base text-ink-soft">{t.dataReceiptIntro}</p></div>
          <button type="button" autoFocus onClick={() => setOpen(false)} aria-label={t.close} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-line bg-white text-ink"><X aria-hidden="true" className="h-5 w-5" /></button>
        </div>
        <div className="space-y-3">
          {rainfall.provenance ? <section className="rounded-xl border border-divider bg-white p-4">
            <h3 className="mb-2 text-base font-bold text-forest">{t.rainfallReceipt}</h3>
            <dl>
              <MetadataRow label="Source" value={rainfall.provenance.source_name} />
              <MetadataRow label="Dataset / product" value={rainfall.provenance.dataset} />
              <MetadataRow label="Version" value={rainfall.provenance.version} />
              <MetadataRow label="Kind" value={rainfall.provenance.kind} />
              <MetadataRow label="Valid from (UTC)" value={rainfall.provenance.observed_start_utc} />
              <MetadataRow label="Valid to (UTC)" value={rainfall.provenance.observed_end_utc} />
              <MetadataRow label="Fetched (UTC)" value={rainfall.provenance.fetched_at_utc} />
              <MetadataRow label="Resolution" value={rainfall.provenance.spatial_resolution} />
              <MetadataRow label="Latency" value={rainfall.provenance.latency_note} />
              <MetadataRow label="Coverage" value={rainfall.provenance.coverage_fraction} />
              <MetadataRow label="Units" value={rainfall.provenance.units} />
              <MetadataRow label="Spatial method" value={rainfall.provenance.spatial_method} />
            </dl>
          </section> : <p className="rounded-xl border border-amber bg-amber-soft p-4 text-base text-amber-ink">{t.rainfallReceiptUnavailable}</p>}
          <SourceReceipt title={t.powerReceipt} source={data.power_summary.freshness} />
          <SourceReceipt title={t.elevationReceipt} source={data.elevation.freshness} />
          <SourceReceipt title={t.soilReceipt} source={data.soil_texture.freshness} />
          <SourceReceipt title={t.forecastReceipt} source={data.forecast.freshness} />
        </div>
      </section>
    </div>}
  </>;
}
