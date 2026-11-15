"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { AgrochemicalSafetyRecord, FarmerContentResponse } from "@/types/safefield";
import { getDict, type Lang } from "@/i18n";
import { ExternalLink, ShieldAlert } from "lucide-react";

const PRODUCT_ALIASES: Record<string, string> = {
  "Compost/FYM": "Compost / Farmyard manure",
};

const CLASS_ORDER: AgrochemicalSafetyRecord["productClass"][] = [
  "fertilizer",
  "insecticide",
  "fungicide",
  "herbicide",
];

interface AgrochemicalSafetyProps {
  lang: Lang;
  /** Fertilizer chosen on the field screen; the safety panel follows it. */
  initialProduct: string;
}

export default function AgrochemicalSafety({ lang, initialProduct }: AgrochemicalSafetyProps) {
  const t = getDict(lang);
  const [content, setContent] = useState<FarmerContentResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [product, setProduct] = useState<string>(PRODUCT_ALIASES[initialProduct] ?? initialProduct);
  const [syncedProduct, setSyncedProduct] = useState(initialProduct);

  // The fertilizer chosen on the field screen should drive this panel without
  // overriding a pesticide the farmer picked here. Adjust state during render
  // (React's recommended pattern) instead of echoing it in an effect.
  if (initialProduct !== syncedProduct) {
    setSyncedProduct(initialProduct);
    setProduct(PRODUCT_ALIASES[initialProduct] ?? initialProduct);
  }

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const base = process.env.NEXT_PUBLIC_API_BASE_URL || "https://safefield-nepal-spaceapps-2026.onrender.com";
    fetch(base + "/api/content", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Content endpoint unavailable");
        return response.json() as Promise<FarmerContentResponse>;
      })
      .then((body) => {
        setContent(body);
        setFailed(false);
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name !== "AbortError") {
          setFailed(true);
          setContent(null);
        }
      })
      .finally(() => setLoading(false));
    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, []);

  const groups = useMemo(() => {
    const records = content?.agrochemical_safety ?? [];
    return CLASS_ORDER.map((productClass) => ({
      productClass,
      records: records.filter((record) => record.productClass === productClass),
    })).filter((group) => group.records.length > 0);
  }, [content]);

  const classLabel: Record<AgrochemicalSafetyRecord["productClass"], string> = {
    fertilizer: t.safetyClassFertilizer,
    insecticide: t.safetyClassInsecticide,
    fungicide: t.safetyClassFungicide,
    herbicide: t.safetyClassHerbicide,
  };

  const record = (content?.agrochemical_safety ?? []).find((entry) => entry.products.includes(product)) ?? null;
  const sourced = record ? record.measures.filter((measure) => measure.basis === "source") : [];
  const assumptions = record ? record.measures.filter((measure) => measure.basis === "assumption") : [];
  const citedSources = sourced.flatMap((measure) => {
    const source = measure.sourceKey ? content?.sources[measure.sourceKey] : undefined;
    return source ? [{ measure, source }] : [];
  });

  return (
    <section className="space-y-4 rounded-2xl border border-line bg-white p-6 shadow-card" aria-labelledby="safety-title">
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-soft text-amber-ink">
          <ShieldAlert className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h3 id="safety-title" className="text-xl font-bold text-ink">{t.safetyPanelTitle}</h3>
          <p className="mt-1 text-sm leading-6 text-ink-soft">{t.safetyBody}</p>
        </div>
      </div>

      <div>
        <label htmlFor="safety-product" className="mb-2 block text-sm font-semibold text-ink-soft">
          {t.safetySelectLabel}
        </label>
        <select
          id="safety-product"
          value={product}
          onChange={(event) => setProduct(event.target.value)}
          className="w-full rounded-full border border-line bg-white px-4 py-3 font-medium text-ink focus:border-action focus:ring-4 focus:ring-action/15"
        >
          {groups.length > 0 ? (
            groups.map((group) => (
              <optgroup key={group.productClass} label={classLabel[group.productClass]}>
                {group.records.flatMap((entry) =>
                  entry.products.map((name) => (
                    <option key={`${entry.id}-${name}`} value={name}>{name}</option>
                  )),
                )}
              </optgroup>
            ))
          ) : (
            <option value={product}>{product}</option>
          )}
        </select>
      </div>

      <p className="rounded-lg border border-amber bg-amber-soft p-3 text-sm leading-6 text-amber-ink">{t.safetyNoDose}</p>

      {loading && <p role="status" className="text-sm text-ink-soft">{t.safetyLoading}</p>}

      {!loading && failed && (
        <p role="status" className="rounded-xl bg-soft p-3 text-sm text-ink-soft">{t.safetyUnavailable}</p>
      )}

      {!loading && !failed && !record && (
        <p role="status" className="rounded-xl bg-soft p-3 text-sm text-ink-soft">{t.safetyNoRecord}</p>
      )}

      {record && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-base font-bold text-ink">{product}</h4>
            <span className="rounded-full bg-brand-blue-soft px-2.5 py-1 text-[11px] font-semibold text-brand-blue-deep">
              {classLabel[record.productClass]}
            </span>
          </div>

          {record.reviewStatus !== "expert-reviewed" && (
            <p className="rounded-lg border border-amber bg-amber-soft p-3 text-xs font-semibold text-amber-ink">
              {t.safetyUnreviewed}
            </p>
          )}

          {sourced.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-bold uppercase tracking-wide text-ink-muted">{t.safetySourceLabel}</p>
              <ul className="space-y-2">
                {sourced.map((measure, index) => {
                  const source = measure.sourceKey ? content?.sources[measure.sourceKey] : undefined;
                  return (
                    <li key={`source-${index}`} className="rounded-lg border border-[#D7E9FF] bg-surface-blue p-3">
                      <p className="text-sm leading-6 text-ink">{lang === "ne" ? measure.textNe : measure.textEn}</p>
                      {source && (
                        <p className="mt-1 text-xs text-ink-soft">
                          {source.authority} · {source.title} ·{" "}
                          {source.url ? (
                            <a
                              href={source.url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-0.5 font-semibold text-brand-blue-deep underline hover:text-brand-blue"
                            >
                              {t.openSource}
                              <ExternalLink className="h-3 w-3" aria-hidden="true" />
                            </a>
                          ) : (
                            t.safetySourceLabel
                          )}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {assumptions.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-bold uppercase tracking-wide text-ink-muted">{t.safetyGeneralLabel}</p>
              <ul className="space-y-2">
                {assumptions.map((measure, index) => (
                  <li key={`assumption-${index}`} className="rounded-lg border border-line bg-soft p-3">
                    <p className="text-sm leading-6 text-ink">{lang === "ne" ? measure.textNe : measure.textEn}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-xs leading-5 text-ink-soft">{t.safetyLabelAuthority}</p>

          {citedSources.length > 0 && (
            <p className="text-[11px] leading-5 text-ink-muted">
              {t.irrigationSource}: {Array.from(new Set(citedSources.map(({ source }) => source.authority))).join(" · ")}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
