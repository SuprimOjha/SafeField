"use client";

import React from "react";
import { MessageCircleQuestion, ShieldCheck } from "lucide-react";
import { getDict, type Lang } from "@/i18n";

export default function ScreenAskHub({ lang }: { lang: Lang }) {
  const t = getDict(lang);

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-5" aria-labelledby="ask-hub-title">
      <div className="rounded-2xl border border-[#C7E0FF] bg-brand-blue-soft p-6 shadow-card sm:p-8">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-brand-blue-deep">
          <MessageCircleQuestion className="h-4 w-4" aria-hidden="true" />
          {t.askHubEyebrow}
        </div>
        <h2 id="ask-hub-title" className="text-2xl font-bold tracking-tight text-brand-blue-deep sm:text-3xl">{t.askHubTitle}</h2>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-ink-soft">{t.askHubBody}</p>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event("safefield-open-ask"))}
          className="mt-6 inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-action px-6 py-3 text-sm font-semibold text-white transition hover:bg-action-pressed active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2"
        >
          <MessageCircleQuestion className="h-5 w-5" aria-hidden="true" />
          {t.askHubButton}
        </button>
      </div>
      <div className="flex items-start gap-3 rounded-xl border border-info/30 bg-info-soft p-4 text-sm leading-6 text-ink-soft">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-info" aria-hidden="true" />
        <p>{t.askHubPrivacy}</p>
      </div>
    </section>
  );
}
