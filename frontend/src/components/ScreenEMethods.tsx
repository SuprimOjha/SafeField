"use client";

import React from "react";
import { FieldAssessmentResponse, FreshnessBadgeData } from "@/types/safefield";
import { Database, ExternalLink, ShieldAlert, CheckCircle2, Clock } from "lucide-react";

interface ScreenEMethodsProps {
  data: FieldAssessmentResponse | null;
  lang: "en" | "ne";
}

export default function ScreenEMethods({ data, lang }: ScreenEMethodsProps) {
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
          <h2 className="text-2xl font-bold text-emerald-950">
            {lang === "ne"
              ? "५. वैज्ञानिक विधि र उपग्रह डाटा स्रोतहरू"
              : "5. Methods, Statistical Rigor & Data Provenance"}
          </h2>
        </div>

        <p className="text-sm text-gray-700 leading-relaxed">
          {lang === "ne"
            ? "सेफ फिल्ड नेपालले मल हाल्ने निर्णयको लागि NASA का आधिकारिक भू-अवलोकन डाटा र प्रमाणित कृषि नियमहरू प्रयोग गर्दछ। कुनै पनि संख्या वा निर्णय अनुमानमा आधारित छैन।"
            : "Safe Field Nepal combines NASA Earth observation datasets with non-parametric climate statistics and deterministic agronomic rules. Every NASA and non-NASA data stream is explicitly labeled below with live latency and spatial resolution caveats."}
        </p>

        {/* Methodology Highlights */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
          <div className="p-4 rounded-xl bg-emerald-50/50 border border-emerald-200">
            <h3 className="font-bold text-emerald-950 text-sm mb-1">1. Satellite & Gridded Proxies</h3>
            <p className="text-xs text-gray-700 leading-relaxed">
              Daily rainfall, surface/root-zone soil wetness, and 30m DEM terrain slope are retrieved via NASA POWER,
              GPM IMERG, SMAP, and NASADEM APIs with SQLite offline caching.
            </p>
          </div>
          <div className="p-4 rounded-xl bg-emerald-50/50 border border-emerald-200">
            <h3 className="font-bold text-emerald-950 text-sm mb-1">2. Autocorrelated Trend Analysis</h3>
            <p className="text-xs text-gray-700 leading-relaxed">
              Multi-year heavy-rain frequency is evaluated using the Theil-Sen estimator, lag-1 autocorrelation-adjusted
              Mann-Kendall significance testing, and Benjamini-Hochberg FDR control.
            </p>
          </div>
          <div className="p-4 rounded-xl bg-emerald-50/50 border border-emerald-200">
            <h3 className="font-bold text-emerald-950 text-sm mb-1">3. Deterministic Agronomic Rules</h3>
            <p className="text-xs text-gray-700 leading-relaxed">
              Fertilizer signals (APPLY NOW, WAIT, SPLIT) follow transparent thresholds from FAO and NARC extension
              standards—evaluating leaching, runoff slope, and 48h storm risk.
            </p>
          </div>
        </div>
      </div>

      {/* Live Source Provenance Cards */}
      <div className="space-y-4">
        <h3 className="text-lg font-bold text-gray-900 px-1">
          {lang === "ne" ? "प्रत्यक्ष डाटा स्रोत स्थिति (Live Source Audit)" : "Active Dataset Provenance & Latency"}
        </h3>

        {sources.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {sources.map((src, idx) => (
              <div key={idx} className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex flex-col justify-between space-y-3">
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <span
                      className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${
                        src.is_nasa
                          ? "bg-indigo-100 text-indigo-900 border border-indigo-200"
                          : "bg-blue-100 text-blue-900 border border-blue-200"
                      }`}
                    >
                      {src.is_nasa ? "NASA EARTH DATA" : "NON-NASA SOURCE"}
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
                      <strong>Latest Observation:</strong> {src.latest_observation_date || "N/A"}
                    </div>
                    <div>
                      <strong>Spatial Resolution:</strong> {src.spatial_resolution}
                    </div>
                    <div>
                      <strong>Typical Latency:</strong> {src.typical_latency}
                    </div>
                  </div>

                  <p className="text-xs text-gray-600 mt-3 leading-relaxed">
                    <strong>Caveat:</strong> {src.caveat}
                  </p>
                </div>

                <div className="pt-2 border-t border-gray-100 flex justify-end">
                  <a
                    href={src.docs_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-800 hover:text-emerald-950"
                  >
                    Official Documentation <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-white p-6 rounded-2xl border border-gray-200 text-sm text-gray-600">
            Run a field assessment on Screen 1 & 2 to inspect live dataset freshness metadata.
          </div>
        )}
      </div>

      {/* Explicit Disclaimer */}
      <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl flex items-start gap-3 text-xs text-amber-950">
        <ShieldAlert className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
        <p>
          <strong>Decision Support Disclaimer:</strong> Safe Field Nepal provides educational and operational decision
          support derived from coarse-resolution satellite grids (~10–55 km) and regional agronomic thresholds. Always
          cross-check with local field moisture and Nepal Agricultural Research Council (NARC) extension advisories.
        </p>
      </div>
    </div>
  );
}