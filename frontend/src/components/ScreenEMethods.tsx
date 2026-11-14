"use client";

import React from "react";
import { FieldAssessmentResponse, FreshnessBadgeData } from "@/types/safefield";
import { Database, ExternalLink, ShieldAlert, CheckCircle2, Clock } from "lucide-react";
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
      <div className="bg-white p-6 rounded-2xl border border-emerald-100 shadow-sm space-y-4">
        <div className="flex items-center gap-2.5">
          <Database className="w-6 h-6 text-emerald-800" />
          <h2 className="text-2xl font-bold text-emerald-950">{t.methodsTitle}</h2>
        </div>

        <p className="text-sm text-gray-700 leading-relaxed">{t.methodsIntro}</p>

        {/* Methodology Highlights */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
          <div className="p-4 rounded-xl bg-emerald-50/50 border border-emerald-200">
            <h3 className="font-bold text-emerald-950 text-sm mb-1">{t.method1Title}</h3>
            <p className="text-xs text-gray-700 leading-relaxed">{t.method1Body}</p>
          </div>
          <div className="p-4 rounded-xl bg-emerald-50/50 border border-emerald-200">
            <h3 className="font-bold text-emerald-950 text-sm mb-1">{t.method2Title}</h3>
            <p className="text-xs text-gray-700 leading-relaxed">{t.method2Body}</p>
          </div>
          <div className="p-4 rounded-xl bg-emerald-50/50 border border-emerald-200">
            <h3 className="font-bold text-emerald-950 text-sm mb-1">{t.method3Title}</h3>
            <p className="text-xs text-gray-700 leading-relaxed">{t.method3Body}</p>
          </div>
        </div>
      </div>

      {/* Live Source Provenance Cards */}
      <div className="space-y-4">
        <h3 className="text-lg font-bold text-gray-900 px-1">{t.provenanceTitle}</h3>

        {sources.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {sources.map((src, idx) => (
              <div key={idx} className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex flex-col justify-between space-y-3">
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <span
                      className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${
                        src.is_nasa
                          ? "bg-emerald-100 text-emerald-900 border border-emerald-200"
                          : "bg-sky-100 text-sky-900 border border-sky-200"
                      }`}
                    >
                      {src.is_nasa ? t.nasaSource : t.nonNasaSource}
                    </span>

                    <span
                      className={`inline-flex items-center gap-1 text-xs font-bold px-2.5 py-0.5 rounded-full ${
                        src.status === "LIVE"
                          ? "bg-emerald-100 text-emerald-900"
                          : "bg-amber-100 text-amber-900"
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

                  <h4 className="font-bold text-gray-900 text-base">{src.dataset_name}</h4>
                  <p className="text-xs text-gray-500 mt-0.5">{src.source_org}</p>

                  <div className="mt-3 space-y-1 text-xs text-gray-700 bg-gray-50 p-3 rounded-xl border border-gray-100">
                    <div>
                      <strong>{t.latestObservation}</strong> {src.latest_observation_date || "N/A"}
                    </div>
                    <div>
                      <strong>{t.spatialResolution}</strong> {src.spatial_resolution}
                    </div>
                    <div>
                      <strong>{t.typicalLatency}</strong> {src.typical_latency}
                    </div>
                  </div>

                  <p className="text-xs text-gray-600 mt-3 leading-relaxed">
                    <strong>{t.caveatLabel}</strong> {src.caveat}
                  </p>
                </div>

                <div className="pt-2 border-t border-gray-100 flex justify-end">
                  <a
                    href={src.docs_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-800 hover:text-emerald-950"
                  >
                    {t.officialDocs} <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-white p-6 rounded-2xl border border-gray-200 text-sm text-gray-600">
            {t.provenanceEmpty}
          </div>
        )}
      </div>


      {data?.rainfall_observation.provenance && (
        <div className="rounded-2xl border border-sky-200 bg-white p-5 space-y-2">
          <h3 className="font-bold text-slate-900">{t.rainfallProvenanceTitle}</h3>
          <p className="text-sm text-slate-700">{data.rainfall_observation.provenance.source_name} · {data.rainfall_observation.provenance.kind}</p>
          <p className="text-xs text-slate-600">{t.observed} {data.rainfall_observation.provenance.observed_start_utc} – {data.rainfall_observation.provenance.observed_end_utc}</p>
          <p className="text-xs text-slate-600">{t.fetched} {data.rainfall_observation.provenance.fetched_at_utc} · {data.rainfall_observation.provenance.spatial_resolution ?? t.resolutionNotSupplied}</p>
          <p className="text-xs text-slate-600">{data.rainfall_observation.provenance.latency_note}</p>
          <p className="text-xs text-slate-600">{t.provenanceCoverageNote}</p>
          <p className="text-xs text-slate-600">{t.spatialMethodLabel} {data.rainfall_observation.provenance.spatial_method}; {t.coverageLabel} {data.rainfall_observation.provenance.coverage_fraction === null ? t.coverageNotApplicable : Math.round(data.rainfall_observation.provenance.coverage_fraction * 100) + "%"}</p>
          <p className="text-xs text-slate-600">{t.datasetLabel} {data.rainfall_observation.provenance.dataset}, {t.versionLabel} {data.rainfall_observation.provenance.version}, {t.streamLabel} {data.rainfall_observation.provenance.stream ?? t.streamNotApplicable}</p>
        </div>
      )}

      {/* Explicit Disclaimer */}
      <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl flex items-start gap-3 text-xs text-amber-950">
        <ShieldAlert className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
        <p>
          <strong>{t.methodsDisclaimerTitle}</strong> {t.methodsDisclaimerBody}
        </p>
      </div>
    </div>
  );
}
