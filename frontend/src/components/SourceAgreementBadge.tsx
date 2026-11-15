"use client";

import React from "react";
import { GitCompareArrows } from "lucide-react";
import type { Dictionary } from "@/i18n";
import { getDict, type Lang } from "@/i18n";
import type { AgreementState, SourceAgreement } from "@/types/safefield";

function stateKey(state: AgreementState): keyof Dictionary {
  switch (state) {
    case "agree":
      return "agreementAgree";
    case "partial":
      return "agreementPartial";
    case "disagree":
      return "agreementDisagree";
    case "not_comparable":
      return "agreementNotComparable";
    default:
      return "agreementInsufficient";
  }
}

function stateClass(state: AgreementState): string {
  if (state === "agree") return "border-success/30 bg-success-soft text-success";
  if (state === "partial") return "border-amber bg-amber-soft text-amber-ink";
  if (state === "disagree") return "border-danger/30 bg-danger-soft text-danger";
  return "border-line bg-soft text-ink-soft";
}

export default function SourceAgreementBadge({ agreement, lang }: { agreement: SourceAgreement; lang: Lang }) {
  const t = getDict(lang);
  return (
    <section aria-labelledby="source-agreement-title" className="rounded-2xl border border-line bg-white p-4 shadow-card">
      <div className="flex items-start gap-3">
        <GitCompareArrows aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-info" />
        <div className="min-w-0 flex-1">
          <h3 id="source-agreement-title" className="text-base font-bold text-ink">{t.agreementTitle}</h3>
          <p className={`mt-2 inline-block rounded-full border px-3 py-1 text-xs font-bold ${stateClass(agreement.state)}`}>
            {t[stateKey(agreement.state)]}
          </p>
          <p className="mt-2 text-sm leading-6 text-ink-soft">{agreement.summary}</p>
          {agreement.sources.length > 0 ? (
            <ul className="mt-2 space-y-1 text-xs leading-5 text-ink-soft">
              {agreement.sources.map((source) => (
                <li key={`${source.source_name}-${source.observed_end_date}-${source.window_hours}`} className="tnum flex flex-wrap gap-x-2">
                  <span className="font-semibold text-ink">{source.source_name}</span>
                  <span>{source.amount_mm} mm</span>
                  <span>· {source.window_hours} h</span>
                  <span>· {source.observed_end_date}</span>
                  <span>· {source.is_nasa ? t.signalNasaYes : t.signalNasaNo}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {agreement.spread_mm !== null ? (
            <p className="tnum mt-2 text-xs font-semibold text-ink-soft">
              {t.agreementSpread}: {agreement.spread_mm} mm
            </p>
          ) : null}
          {agreement.tolerance_note ? <p className="tnum mt-1 text-xs leading-5 text-ink-muted">{agreement.tolerance_note}</p> : null}
          <p className="mt-2 text-xs leading-5 text-ink-muted">{agreement.assumption_note}</p>
        </div>
      </div>
    </section>
  );
}
