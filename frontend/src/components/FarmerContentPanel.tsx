"use client";

import React, { useEffect, useState } from "react";
import type { FarmerContentResponse } from "@/types/safefield";
import { getDict, type Lang } from "@/i18n";

export default function FarmerContentPanel({ lang }: { lang: Lang }) {
  const [content, setContent] = useState<FarmerContentResponse | null>(null);
  const t = getDict(lang);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    // Optional backend-only content packs. Keep the last-known hosted backend
    // as fallback; the panel simply hides when it is unreachable.
    const base = process.env.NEXT_PUBLIC_API_BASE_URL || "https://safefield-nepal-spaceapps-2026.onrender.com";
    fetch(base + "/api/content", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Content endpoint unavailable");
        return response.json() as Promise<FarmerContentResponse>;
      })
      .then(setContent)
      .catch((error: unknown) => {
        if (error instanceof Error && error.name !== "AbortError") setContent(null);
      });
    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, []);

  if (!content) return null;
  const allGuidance = [...content.fertilizer_references, ...content.home_remedies];
  const hasUnreviewedGuidance = allGuidance.some(
    (item) => item.reviewStatus !== "expert-reviewed" || !item.reviewer,
  );
  const allGuidanceExpertReviewed = allGuidance.length > 0 && !hasUnreviewedGuidance;

  return (
    <section className="rounded-2xl border border-sky-200 bg-white p-5 space-y-4">
      <div>
        <h3 className="text-lg font-extrabold text-slate-900">
          {t.contentTitle}
        </h3>
        {hasUnreviewedGuidance && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">
            {t.contentUnreviewed}
          </p>
        )}
        {allGuidanceExpertReviewed && (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-900">
            {t.contentReviewed}
          </p>
        )}
        {!content.fertilizer_references.length && !content.home_remedies.length && (
          <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            {t.contentEmpty}
          </p>
        )}
        <p className="text-sm leading-6 text-slate-600">
          {t.contentReferencesOnly}
        </p>
      </div>

      {content.fertilizer_references.map((item) => {
        const source = content.sources[item.sourceKey];
        const bound = item.valueMin !== null && item.valueMax !== null
          ? item.valueMin + "–" + item.valueMax
          : String(item.valueMin ?? item.valueMax);
        return (
          <article key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
            <h4 className="font-bold text-slate-900">{item.crop} · {item.nutrientOrProduct}</h4>
            <p className="text-xl font-extrabold text-emerald-900">{bound} {item.unitAsPrinted}</p>
            <p className="text-xs text-slate-600">
              {t.referenceOnly} · {source?.title ?? item.sourceKey}, {item.year} · {item.page}
            </p>
            {item.secondSourceKey && content.sources[item.secondSourceKey] && (
              <p className="text-xs text-slate-600">{t.secondSource} {content.sources[item.secondSourceKey].title} ({content.sources[item.secondSourceKey].authority})</p>
            )}
            <p className="text-sm text-slate-700">{item.timingSplit}</p>
            <p className="text-xs font-semibold text-slate-600">
              {t.reviewLabel} {item.reviewStatus}{item.reviewer ? ` · ${item.reviewer}` : ""}
            </p>
            <p className="text-xs text-slate-600">
              {t.contentLabelNote}
            </p>
            {source?.url && (
              <a className="text-sm font-semibold text-emerald-800 underline" href={source.url} target="_blank" rel="noreferrer">
                {source.authority} — {t.openSource}
              </a>
            )}
          </article>
        );
      })}

      {content.home_remedies.map((item) => {
        const source = content.sources[item.sourceKey];
        return (
          <article key={item.id} className="rounded-xl border border-slate-200 p-4 space-y-2">
            <h4 className="font-bold text-slate-900">{item.crop} · {item.problem}</h4>
            <p className="text-sm text-slate-700">{item.remedyText}</p>
            {item.quantitiesAsPrinted && source?.official && (
              <p className="text-sm font-semibold text-slate-800">{t.quantityAsPrinted} {item.quantitiesAsPrinted}</p>
            )}
            {!source?.official && (
              <p className="text-sm font-semibold text-amber-800">{t.nonOfficialSource}</p>
            )}
            {item.preparationNotesAsPrinted && <p className="text-sm text-slate-600">{item.preparationNotesAsPrinted}</p>}
            <p className="text-sm text-slate-700">{t.safetyNotesLabel} {item.safetyNotes}</p>
            <p className="text-xs text-slate-600">{source?.title ?? item.sourceKey} · {item.evidence} · {item.reviewStatus}{item.reviewer ? " by " + item.reviewer : ""}</p>
            {source?.url && (
              <a className="text-sm font-semibold text-emerald-800 underline" href={source.url} target="_blank" rel="noreferrer">
                {source.authority} — {t.openSource}
              </a>
            )}
          </article>
        );
      })}
    </section>
  );
}
