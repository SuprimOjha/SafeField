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
    <section className="rounded-xl border border-divider bg-white p-5 shadow-float space-y-4">
      <div>
        <h3 className="text-lg font-extrabold text-forest">
          {t.contentTitle}
        </h3>
        {hasUnreviewedGuidance && (
          <p className="rounded-lg border border-amber bg-amber-soft p-3 text-sm font-semibold text-amber-ink">
            {t.contentUnreviewed}
          </p>
        )}
        {allGuidanceExpertReviewed && (
          <p className="rounded-lg border border-divider bg-mint p-3 text-sm font-semibold text-forest">
            {t.contentReviewed}
          </p>
        )}
        {!content.fertilizer_references.length && !content.home_remedies.length && (
          <p className="rounded-xl bg-cream p-3 text-sm text-ink-soft">
            {t.contentEmpty}
          </p>
        )}
        <p className="text-sm leading-6 text-ink-soft">
          {t.contentReferencesOnly}
        </p>
      </div>

      {content.fertilizer_references.map((item) => {
        const source = content.sources[item.sourceKey];
        const bound = item.valueMin !== null && item.valueMax !== null
          ? item.valueMin + "–" + item.valueMax
          : String(item.valueMin ?? item.valueMax);
        return (
          <article key={item.id} className="rounded-lg border border-divider bg-white p-4 space-y-2">
            <h4 className="font-bold text-ink">{item.crop} · {item.nutrientOrProduct}</h4>
            <p className="text-xl font-extrabold text-forest tnum">{bound} {item.unitAsPrinted}</p>
            <p className="text-xs text-ink-soft tnum">
              {t.referenceOnly} · {source?.title ?? item.sourceKey}, {item.year} · {item.page}
            </p>
            {item.secondSourceKey && content.sources[item.secondSourceKey] && (
              <p className="text-xs text-ink-soft">{t.secondSource} {content.sources[item.secondSourceKey].title} ({content.sources[item.secondSourceKey].authority})</p>
            )}
            <p className="text-sm text-ink-soft">{item.timingSplit}</p>
            <p className="text-xs font-semibold text-ink-soft">
              {t.reviewLabel} {item.reviewStatus}{item.reviewer ? ` · ${item.reviewer}` : ""}
            </p>
            <p className="text-xs text-ink-soft">
              {t.contentLabelNote}
            </p>
            {source?.url && (
              <a className="text-sm font-semibold text-forest underline hover:text-leaf" href={source.url} target="_blank" rel="noreferrer">
                {source.authority} — {t.openSource}
              </a>
            )}
          </article>
        );
      })}

      {content.home_remedies.map((item) => {
        const source = content.sources[item.sourceKey];
        return (
          <article key={item.id} className="rounded-lg border border-divider bg-white p-4 space-y-2">
            <h4 className="font-bold text-ink">{item.crop} · {item.problem}</h4>
            <p className="text-sm text-ink-soft">{item.remedyText}</p>
            {item.quantitiesAsPrinted && source?.official && (
              <p className="text-sm font-semibold text-ink">{t.quantityAsPrinted} {item.quantitiesAsPrinted}</p>
            )}
            {!source?.official && (
              <p className="text-sm font-semibold text-amber-ink">{t.nonOfficialSource}</p>
            )}
            {item.preparationNotesAsPrinted && <p className="text-sm text-ink-soft">{item.preparationNotesAsPrinted}</p>}
            <p className="text-sm text-ink-soft">{t.safetyNotesLabel} {item.safetyNotes}</p>
            <p className="text-xs text-ink-soft">{source?.title ?? item.sourceKey} · {item.evidence} · {item.reviewStatus}{item.reviewer ? " by " + item.reviewer : ""}</p>
            {source?.url && (
              <a className="text-sm font-semibold text-forest underline hover:text-leaf" href={source.url} target="_blank" rel="noreferrer">
                {source.authority} — {t.openSource}
              </a>
            )}
          </article>
        );
      })}
    </section>
  );
}
