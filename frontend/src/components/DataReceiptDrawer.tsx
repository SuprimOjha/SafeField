"use client";

import { useEffect, useRef, useState } from "react";
import { Database, X } from "lucide-react";
import type { FieldAssessmentResponse, FreshnessBadgeData } from "@/types/safefield";
import { getDict, type Lang } from "@/i18n";

interface DataReceiptDrawerProps { data: FieldAssessmentResponse; lang: Lang; }

function MetadataRow({ label, value }: { label: string; value: string | number | null | undefined }) {
  return <div className="grid grid-cols-[minmax(7rem,0.8fr)_minmax(0,1.2fr)] gap-3 border-b border-divider py-2 last:border-0">
    <dt className="text-sm text-ink-soft">{label}</dt>
    <dd className="tnum break-words text-sm font-semibold text-ink">{value === null || value === undefined || value === "" ? "—" : String(value)}</dd>
  </div>;
}

function SourceReceipt({ title, source, t }: { title: string; source: FreshnessBadgeData; t: ReturnType<typeof getDict> }) {
  return <section className="rounded-xl border border-divider bg-white p-4">
    <h3 className="mb-2 text-base font-bold text-ink">{title}</h3>
    <dl>
      <MetadataRow label={t.receiptDataset} value={source.dataset_name} />
      <MetadataRow label={t.receiptVersion} value={t.receiptNotExposed} />
      <MetadataRow label={t.receiptKind} value={t.receiptNotExposed} />
      <MetadataRow label={t.receiptSource} value={source.source_org} />
      <MetadataRow label={t.receiptNasa} value={source.is_nasa ? t.receiptYes : t.receiptNo} />
      <MetadataRow label={t.receiptStatus} value={source.status} />
      <MetadataRow label={t.receiptLatestDate} value={source.latest_observation_date} />
      <MetadataRow label={t.receiptFetched} value={source.fetched_at_utc} />
      <MetadataRow label={t.receiptLatency} value={source.typical_latency} />
      <MetadataRow label={t.receiptResolution} value={source.spatial_resolution} />
      <MetadataRow label={t.receiptLimitations} value={source.caveat} />
    </dl>
    {source.docs_url ? <a href={source.docs_url} target="_blank" rel="noreferrer" className="mt-3 inline-flex min-h-12 items-center font-semibold text-info underline underline-offset-4">{t.receiptDocumentation}</a> : null}
  </section>;
}

export default function DataReceiptDrawer({ data, lang }: DataReceiptDrawerProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const t = getDict(lang);
  useEffect(() => {
    if (!open) { triggerRef.current?.focus(); return; }
    const handleKeys = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); return; }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const items = dialogRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])");
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", handleKeys);
    return () => window.removeEventListener("keydown", handleKeys);
  }, [open]);
  const rainfall = data.rainfall_observation;
  return <>
    <button ref={triggerRef} type="button" onClick={() => setOpen(true)} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-line bg-white px-5 py-3 text-base font-bold text-brand-blue-deep hover:bg-soft focus-visible:outline-offset-4">
      <Database aria-hidden="true" className="h-5 w-5" />{t.showDataReceipt}
    </button>
    {open && <div className="fixed inset-0 z-[100] flex items-end justify-center bg-charcoal/55 sm:items-center sm:p-5" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="data-receipt-title" className="max-h-[88dvh] w-full max-w-2xl overflow-y-auto rounded-t-2xl border border-divider bg-white p-5 shadow-sheet sm:rounded-2xl sm:p-6">
        <div className="sticky top-0 z-10 -mx-1 mb-4 flex items-center justify-between gap-3 border-b border-divider bg-white px-1 py-2">
          <div><h2 id="data-receipt-title" className="text-xl font-bold text-ink">{t.dataReceiptTitle}</h2><p className="text-base text-ink-soft">{t.dataReceiptIntro}</p></div>
          <button type="button" autoFocus onClick={() => setOpen(false)} aria-label={t.close} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-line bg-white text-ink"><X aria-hidden="true" className="h-5 w-5" /></button>
        </div>
        <div className="space-y-3">
          {rainfall.provenance ? <section className="rounded-xl border border-divider bg-white p-4">
            <h3 className="mb-2 text-base font-bold text-ink">{t.rainfallReceipt}</h3>
            <dl>
              <MetadataRow label={t.receiptSource} value={rainfall.provenance.source_name} />
              <MetadataRow label={t.receiptNasa} value={t.receiptNotProvided} />
              <MetadataRow label={t.receiptDataset} value={rainfall.provenance.dataset} />
              <MetadataRow label={t.receiptVersion} value={rainfall.provenance.version} />
              <MetadataRow label={t.receiptKind} value={rainfall.provenance.kind} />
              <MetadataRow label={t.receiptValidFrom} value={rainfall.provenance.observed_start_utc} />
              <MetadataRow label={t.receiptValidTo} value={rainfall.provenance.observed_end_utc} />
              <MetadataRow label={t.receiptFetched} value={rainfall.provenance.fetched_at_utc} />
              <MetadataRow label={t.receiptResolution} value={rainfall.provenance.spatial_resolution} />
              <MetadataRow label={t.receiptLatency} value={rainfall.provenance.latency_note} />
              <MetadataRow label={t.receiptCoverage} value={rainfall.provenance.coverage_fraction} />
              <MetadataRow label={t.receiptUnits} value={rainfall.provenance.units} />
              <MetadataRow label={t.receiptSpatialMethod} value={rainfall.provenance.spatial_method} />
            </dl>
          </section> : <p className="rounded-xl border border-amber bg-amber-soft p-4 text-base text-amber-ink">{t.rainfallReceiptUnavailable}</p>}
          <SourceReceipt title={t.powerReceipt} source={data.power_summary.freshness} t={t} />
          <SourceReceipt title={t.elevationReceipt} source={data.elevation.freshness} t={t} />
          <SourceReceipt title={t.soilReceipt} source={data.soil_texture.freshness} t={t} />
          <SourceReceipt title={t.forecastReceipt} source={data.forecast.freshness} t={t} />
        </div>
      </section>
    </div>}
  </>;
}
