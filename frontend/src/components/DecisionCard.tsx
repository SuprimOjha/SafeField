"use client";

import { AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import type { DecisionResult } from "@/types/safefield";
import { getDict, type Lang } from "@/i18n";

interface DecisionCardProps {
  decision: DecisionResult;
  lang: Lang;
}

/**
 * Farmer-facing summary of the real field-assessment decision.
 * Detailed rules and source evidence remain in the expandable explanation.
 * No application window or recheck time is inferred when the API omits it.
 */
export default function DecisionCard({ decision, lang }: DecisionCardProps) {
  const t = getDict(lang);
  const suitable = decision.signal === "CONDITIONS LOOK SUITABLE";
  const waiting = decision.signal === "WAIT AND RECHECK";
  const label = suitable
    ? t.signalSuitableNe
      ? lang === "ne" ? t.signalSuitableNe : t.signalSuitable
      : t.signalSuitable
    : waiting
      ? lang === "ne" ? t.signalWaitNe : t.signalWait
      : lang === "ne" ? t.signalReviewNe : t.signalReview;
  const tone = suitable
    ? "border-success bg-success-soft text-success"
    : waiting
      ? "border-warning bg-warning-soft text-amber-ink"
      : "border-danger bg-danger-soft text-danger";
  const Icon = suitable ? CheckCircle2 : waiting ? Clock : AlertTriangle;

  return (
    <section
      aria-label={t.decisionBannerLabel}
      aria-live="polite"
      className={`rounded-2xl border-2 p-5 shadow-float sm:p-6 ${tone}`}
    >
      <div className="flex items-start gap-4">
        <Icon aria-hidden="true" className="mt-1 h-9 w-9 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">{t.fieldWorkToday}</p>
          <h2 className="mt-1 text-2xl font-bold leading-tight tracking-tight sm:text-3xl">
            {label}
          </h2>
          {decision.primary_reason ? (
            <p className="mt-3 text-base font-semibold leading-relaxed">
              {decision.primary_reason}
            </p>
          ) : (
            <p className="mt-3 text-base">{t.decisionReasonUnavailable}</p>
          )}
          {waiting && decision.wait_days_recommended > 0 && (
            <p className="mt-3 inline-flex min-h-12 items-center rounded-lg border border-current/30 bg-white/70 px-4 text-base font-bold">
              {t.waitDaysLabel.replace("{days}", String(decision.wait_days_recommended))}
            </p>
          )}
        </div>
      </div>

      <div className="mt-5 space-y-2 border-t border-current/20 pt-4 text-base">
        <p className="font-semibold">{t.followProductLabel}</p>
        <p>{t.notReviewedByAgronomist}</p>
        <p className="text-sm">{t.independentNotEndorsed}</p>
      </div>
    </section>
  );
}
