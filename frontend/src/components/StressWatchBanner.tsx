"use client";

import React from "react";
import { AlertTriangle, CheckCircle2, CircleHelp } from "lucide-react";
import type { Dictionary } from "@/i18n";
import { getDict, type Lang } from "@/i18n";
import type { FactorState, StressFactorName, StressWatch } from "@/types/safefield";

function factorLabelKey(factor: StressFactorName): keyof Dictionary {
  switch (factor) {
    case "water":
      return "stressFactorWater";
    case "heat":
      return "stressFactorHeat";
    case "vegetation":
      return "stressFactorVegetation";
    default:
      return "stressFactorRain";
  }
}

function stateLabelKey(state: FactorState): keyof Dictionary {
  if (state === "watch") return "stressFactorWatch";
  if (state === "no_watch") return "stressFactorNoWatch";
  return "stressFactorUnknown";
}

function stateChipClass(state: FactorState): string {
  if (state === "watch") return "bg-amber-soft text-amber-ink";
  if (state === "no_watch") return "bg-success-soft text-success";
  return "bg-soft text-ink-soft";
}

export default function StressWatchBanner({ watch, lang }: { watch: StressWatch; lang: Lang }) {
  const t = getDict(lang);
  const HeaderIcon = watch.overall === "watch" ? AlertTriangle : watch.overall === "no_watch" ? CheckCircle2 : CircleHelp;
  const containerClass =
    watch.overall === "watch"
      ? "border-amber bg-amber-soft text-amber-ink"
      : watch.overall === "no_watch"
        ? "border-success/30 bg-success-soft text-success"
        : "border-line bg-soft text-ink-soft";
  const headline =
    watch.overall === "watch" ? t.stressWatch : watch.overall === "no_watch" ? t.stressNoWatch : t.stressUnknown;

  return (
    <section aria-labelledby="stress-watch-title" className={`rounded-2xl border p-4 ${containerClass}`}>
      <div className="flex items-start gap-3">
        <HeaderIcon aria-hidden="true" className="mt-0.5 h-6 w-6 shrink-0" />
        <div className="min-w-0 flex-1">
          <h3 id="stress-watch-title" className="text-base font-bold">{headline}</h3>
          <p className="mt-1 text-sm leading-6">{watch.summary}</p>
          <ul className="mt-3 space-y-2">
            {watch.factors.map((factor) => (
              <li key={factor.factor} className="rounded-xl border border-white/60 bg-white/70 p-3 text-ink">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold text-ink">{t[factorLabelKey(factor.factor)]}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${stateChipClass(factor.state)}`}>
                    {t[stateLabelKey(factor.state)]}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-5 text-ink-soft">{factor.reason}</p>
                {factor.evidence.length > 0 ? (
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs leading-5 text-ink-muted">
                    {factor.evidence.map((line, index) => (
                      <li key={`${factor.factor}-${index}`}>{line}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs leading-5">{watch.disclaimer}</p>
        </div>
      </div>
    </section>
  );
}
