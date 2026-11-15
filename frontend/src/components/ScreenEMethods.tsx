"use client";

import React from "react";
import { FieldAssessmentResponse, FreshnessBadgeData } from "@/types/safefield";
import { Database, ExternalLink, ShieldAlert, CheckCircle2, Clock, Satellite, TrendingUp, FlaskConical } from "lucide-react";
import { getDict, type Lang } from "@/i18n";

interface ScreenEMethodsProps {
  data: FieldAssessmentResponse | null;
  lang: Lang;
}

export default function ScreenEMethods({ data, lang }: ScreenEMethodsProps) {
  const t = getDict(lang);
  const sources: FreshnessBadgeData[] = data
    ? [
        data.power_summary.freshness,
        data.elevation.freshness,
        data.forecast.freshness,
        data.soil_texture.freshness,
      ]
    : [];

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-line bg-white p-6 shadow-card space-y-4">
        <div className="flex items-center gap-2.5">
          <Database className="w-6 h-6 text-info" />
          <h2 className="text-2xl font-bold tracking-tight text-ink">{t.methodsTitle}</h2>
        </div>

        <p className="text-sm text-ink-soft leading-relaxed">{t.methodsIntro}</p>

        {/* Methodology Highlights */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
          <div className="rounded-lg border border-divider bg-soft p-4">
            <span className="mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-white text-brand-blue-deep shadow-card"><Satellite className="h-4 w-4" aria-hidden="true" /></span>
            <h3 className="font-bold text-ink text-sm mb-1">{t.method1Title}</h3>
            <p className="text-xs text-ink-soft leading-relaxed">{t.method1Body}</p>
          </div>
          <div className="rounded-lg border border-divider bg-soft p-4">
            <span className="mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-white text-brand-blue-deep shadow-card"><TrendingUp className="h-4 w-4" aria-hidden="true" /></span>
            <h3 className="font-bold text-ink text-sm mb-1">{t.method2Title}</h3>
            <p className="text-xs text-ink-soft leading-relaxed">{t.method2Body}</p>
          </div>
          <div className="rounded-lg border border-divider bg-soft p-4">
            <span className="mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-white text-brand-blue-deep shadow-card"><FlaskConical className="h-4 w-4" aria-hidden="true" /></span>
            <h3 className="font-bold text-ink text-sm mb-1">{t.method3Title}</h3>
            <p className="text-xs text-ink-soft leading-relaxed">{t.method3Body}</p>
          </div>
        </div>
      </div>

      {/* Live Source Provenance Cards */}
      <div className="space-y-4">
        <h3 className="text-lg font-bold text-ink px-1">{t.provenanceTitle}</h3>

        {sources.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {sources.map((src, idx) => (
              <div key={idx} className="rounded-2xl border border-line bg-white p-5 shadow-card flex flex-col justify-between space-y-3">
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <span
                      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                        src.is_nasa
                          ? "bg-soft text-ink-soft"
                          : "bg-info-soft text-info"
                      }`}
                    >
                      {src.is_nasa ? t.nasaSource : t.nonNasaSource}
                    </span>

                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                        src.status === "LIVE"
                          ? "bg-action-soft text-brand-blue-deep"
                          : "bg-amber-soft text-amber-ink"
                      }`}
                    >
                      {src.status === "LIVE" ? (
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      ) : (
                        <Clock className="w-3.5 h-3.5" />
                      )}
                      {src.status}
                    </span>
                  </div>

                  <h4 className="font-bold text-ink text-base">{src.dataset_name}</h4>
                  <p className="text-xs text-ink-muted mt-0.5">{src.source_org}</p>

                  <div className="mt-3 space-y-1 rounded-md border border-divider bg-soft p-3 text-xs text-ink-soft">
                    <div className="tnum">
                      <strong>{t.latestObservation}</strong> {src.latest_observation_date || "N/A"}
                    </div>
                    <div className="tnum">
                      <strong>{t.spatialResolution}</strong> {src.spatial_resolution}
                    </div>
                    <div className="tnum">
                      <strong>{t.typicalLatency}</strong> {src.typical_latency}
                    </div>
                  </div>

                  <p className="text-xs text-ink-soft mt-3 leading-relaxed">
                    <strong>{t.caveatLabel}</strong> {src.caveat}
                  </p>
                </div>

                <div className="pt-2 border-t border-divider flex justify-end">
                  <a
                    href={src.docs_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-semibold text-brand-blue-deep hover:text-brand-blue"
                  >
                    {t.officialDocs} <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-line bg-white p-6 text-sm text-ink-soft shadow-card">
            {t.provenanceEmpty}
          </div>
        )}
      </div>


      {data?.rainfall_observation.provenance && (
        <div className="rounded-2xl border border-info/30 bg-info-soft p-5 space-y-2">
          <h3 className="font-bold text-info">{t.rainfallProvenanceTitle}</h3>
          <p className="text-sm text-ink-soft">{data.rainfall_observation.provenance.source_name} · {data.rainfall_observation.provenance.kind}</p>
          <p className="text-xs text-ink-soft tnum">{t.observed} {data.rainfall_observation.provenance.observed_start_utc} – {data.rainfall_observation.provenance.observed_end_utc}</p>
          <p className="text-xs text-ink-soft tnum">{t.fetched} {data.rainfall_observation.provenance.fetched_at_utc} · {data.rainfall_observation.provenance.spatial_resolution ?? t.resolutionNotSupplied}</p>
          <p className="text-xs text-ink-soft">{data.rainfall_observation.provenance.latency_note}</p>
          <p className="text-xs text-ink-soft">{t.provenanceCoverageNote}</p>
          <p className="text-xs text-ink-soft tnum">{t.spatialMethodLabel} {data.rainfall_observation.provenance.spatial_method}; {t.coverageLabel} {data.rainfall_observation.provenance.coverage_fraction === null ? t.coverageNotApplicable : Math.round(data.rainfall_observation.provenance.coverage_fraction * 100) + "%"}</p>
          <p className="text-xs text-ink-soft">{t.datasetLabel} {data.rainfall_observation.provenance.dataset}, {t.versionLabel} {data.rainfall_observation.provenance.version}, {t.streamLabel} {data.rainfall_observation.provenance.stream ?? t.streamNotApplicable}</p>
        </div>
      )}

      {/* Explicit Disclaimer */}
      <div className="border border-amber bg-amber-soft p-4 rounded-lg flex items-start gap-3 text-xs text-amber-ink">
        <ShieldAlert className="w-5 h-5 text-amber-ink shrink-0 mt-0.5" />
        <p>
          <strong>{t.methodsDisclaimerTitle}</strong> {t.methodsDisclaimerBody}
        </p>
      </div>
    </div>
  );
}
