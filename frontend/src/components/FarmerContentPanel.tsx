"use client";

import React, { useEffect, useState } from "react";
import type { FarmerContentResponse } from "@/types/safefield";

export default function FarmerContentPanel({ lang }: { lang: "en" | "ne" }) {
  const [content, setContent] = useState<FarmerContentResponse | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const base = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";
    fetch(base + "/api/content", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Content endpoint unavailable");
        return response.json() as Promise<FarmerContentResponse>;
      })
      .then(setContent)
      .catch((error: unknown) => {
        if (error instanceof Error && error.name !== "AbortError") setContent(null);
      });
    return () => controller.abort();
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
          {lang === "ne" ? "स्रोतमा आधारित कृषि सन्दर्भ" : "Source-verified farmer references"}
        </h3>
        {hasUnreviewedGuidance && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">
            {lang === "ne" ? "केही अभिलेख विज्ञद्वारा समीक्षा गरिएको भनेर चिनाइएको छैन। कुनै कदम चाल्नुअघि स्थानीय कृषि कार्यालयसँग सल्लाह लिनुहोस्।" : "Some records have not been marked as expert-reviewed. Check with a local agriculture office before acting."}
          </p>
        )}
        {allGuidanceExpertReviewed && (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-900">
            {lang === "ne" ? "देखाइएका सबै अभिलेखमा नामसहितका विज्ञ समीक्षक उल्लेख छन्। यो स्रोत सन्दर्भ मात्र हो, व्यक्तिगत मल सिफारिस होइन।" : "Every displayed record includes a named expert reviewer. This remains a source reference, not a personalized prescription."}
          </p>
        )}
        {!content.fertilizer_references.length && !content.home_remedies.length && (
          <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            No source-backed local guidance has been published yet. Add researched records to the backend content files; unverified records are not displayed.
          </p>
        )}
        <p className="text-sm leading-6 text-slate-600">
          {lang === "ne"
            ? "यी स्रोतका सन्दर्भ मात्र हुन्, व्यक्तिगत मल सिफारिस होइनन्।"
            : "These are source references, not prescriptions or personalized doses."}
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
              Reference only · {source?.title ?? item.sourceKey}, {item.year} · {item.page}
            </p>
            {item.secondSourceKey && content.sources[item.secondSourceKey] && (
              <p className="text-xs text-slate-600">Second source: {content.sources[item.secondSourceKey].title} ({content.sources[item.secondSourceKey].authority})</p>
            )}
            <p className="text-sm text-slate-700">{item.timingSplit}</p>
            <p className="text-xs font-semibold text-slate-600">
              Review: {item.reviewStatus}{item.reviewer ? ` · ${item.reviewer}` : ""}
            </p>
            <p className="text-xs text-slate-600">
              Follow the product label. Soil testing is recommended. Not a prescription.
            </p>
            {source?.url && (
              <a className="text-sm font-semibold text-emerald-800 underline" href={source.url} target="_blank" rel="noreferrer">
                {source.authority} — open source
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
              <p className="text-sm font-semibold text-slate-800">Quantity exactly as printed: {item.quantitiesAsPrinted}</p>
            )}
            {!source?.official && (
              <p className="text-sm font-semibold text-amber-800">Check with your local agriculture office. Non-official source quantities are not shown.</p>
            )}
            {item.preparationNotesAsPrinted && <p className="text-sm text-slate-600">{item.preparationNotesAsPrinted}</p>}
            <p className="text-sm text-slate-700">Safety notes: {item.safetyNotes}</p>
            <p className="text-xs text-slate-600">{source?.title ?? item.sourceKey} · {item.evidence} · {item.reviewStatus}{item.reviewer ? " by " + item.reviewer : ""}</p>
            {source?.url && (
              <a className="text-sm font-semibold text-emerald-800 underline" href={source.url} target="_blank" rel="noreferrer">
                {source.authority} — open source
              </a>
            )}
          </article>
        );
      })}
    </section>
  );
}
