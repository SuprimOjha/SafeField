// Ask assistant — provenance helpers (Work Package 1).
//
// Hard rule 4: state kind and date (observation, model, forecast, fallback,
// cached, farmer input) and label non-NASA sources as non-NASA. Every answer
// that states a number carries source, kind and date into the answer text so
// the text stays complete when read aloud.

import type { FreshnessBadgeData, RainfallProvenance, SourceStatus } from "../../types/safefield";
import type { AskFact, AskLang, AskProvenance, AskUnit, AskValueKind, Bi } from "./types";

export function fmtNum(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "";
  const factor = Math.pow(10, digits);
  const rounded = Math.round(value * factor) / factor;
  return String(rounded);
}

/** Date part (YYYY-MM-DD) of an ISO string; null when unparseable. */
export function fmtDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso.slice(0, 10);
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
}

export function kindWord(kind: AskValueKind, lang: AskLang): string {
  if (lang === "ne") {
    switch (kind) {
      case "observation":
        return "अवलोकन";
      case "model":
        return "मोडेल अनुमान";
      case "forecast":
        return "पूर्वानुमान";
      case "fallback":
        return "वैकल्पिक स्रोत";
      case "cached":
        return "क्यास गरिएको";
      case "farmer_input":
        return "किसानको जानकारी";
    }
  }
  switch (kind) {
    case "observation":
      return "observation";
    case "model":
      return "model estimate";
    case "forecast":
      return "forecast";
    case "fallback":
      return "fallback";
    case "cached":
      return "cached";
    case "farmer_input":
      return "farmer input";
  }
}

export function nasaLabel(isNasa: boolean, lang: AskLang): string {
  if (lang === "ne") return isNasa ? "NASA स्रोत" : "गैर-NASA स्रोत";
  return isNasa ? "NASA source" : "non-NASA source";
}

/** Build normalized provenance from a FreshnessBadgeData (POWER, soil, terrain, forecast). */
export function provenanceFromFreshness(
  valueId: string,
  badge: FreshnessBadgeData,
  baseKind: AskValueKind,
): AskProvenance {
  const kind: AskValueKind = badge.status === "CACHED_FALLBACK" ? "cached" : baseKind;
  return {
    valueId,
    source: `${badge.source_org} ${badge.dataset_name}`.trim(),
    isNasa: badge.is_nasa,
    kind,
    validFrom: null,
    validTo: fmtDate(badge.latest_observation_date),
    fetchedAt: fmtDate(badge.fetched_at_utc),
    resolution: badge.spatial_resolution ?? null,
    latencyNote: badge.typical_latency ?? null,
  };
}

/** Build normalized provenance from the rainfall provenance block. */
export function provenanceFromRainfall(
  valueId: string,
  rain: RainfallProvenance,
): AskProvenance {
  const kind: AskValueKind =
    rain.kind === "observation" || rain.kind === "model" || rain.kind === "forecast" || rain.kind === "fallback" || rain.kind === "farmer_input"
      ? rain.kind
      : "model";
  return {
    valueId,
    source: rain.source_name,
    // IMERG/POWER are NASA; the rainfall block does not carry is_nasa, so we
    // mark NASA when the source name references a NASA dataset, else non-NASA.
    isNasa: /NASA|IMERG|GPM|POWER/i.test(rain.source_name),
    kind,
    validFrom: fmtDate(rain.observed_start_utc),
    validTo: fmtDate(rain.observed_end_utc),
    fetchedAt: fmtDate(rain.fetched_at_utc),
    resolution: rain.spatial_resolution ?? null,
    latencyNote: rain.latency_note ?? null,
  };
}

export function farmerProvenance(valueId: string): AskProvenance {
  return {
    valueId,
    source: "Farmer input",
    isNasa: false,
    kind: "farmer_input",
    validFrom: null,
    validTo: null,
    fetchedAt: null,
    resolution: null,
    latencyNote: null,
  };
}

export function statusToKind(status: SourceStatus, baseKind: AskValueKind): AskValueKind {
  return status === "CACHED_FALLBACK" ? "cached" : baseKind;
}

export function unitWord(unit: AskUnit, lang: AskLang): string {
  if (lang === "ne") {
    switch (unit) {
      case "mm":
        return "मि.मी.";
      case "percent":
        return "प्रतिशत";
      case "celsius":
        return "डिग्री सेल्सियस";
      case "metres":
        return "मिटर";
      case "hours":
        return "घण्टा";
      case "index":
        return "";
      case "none":
        return "";
    }
  }
  switch (unit) {
    case "mm":
      return "mm";
    case "percent":
      return "percent";
    case "celsius":
      return "degrees Celsius";
    case "metres":
      return "metres";
    case "hours":
      return "hours";
    case "index":
      return "";
    case "none":
      return "";
  }
}

export function makeFact(
  id: string,
  label: Bi,
  value: string | null,
  unit: AskUnit,
  provenance: AskProvenance | null,
): AskFact {
  return { id, label, value, unit, provenance };
}

/**
 * Dataset descriptors (resolution, latency notes) may contain "~". That is a
 * markdown-like symbol and reads poorly aloud, so answers render it as words.
 */
export function sanitizeDescriptor(text: string | null): string | null {
  if (text === null) return null;
  return text.replace(/~\s*/g, "approx. ");
}

/**
 * Render one fact as plain read-aloud sentences that always carry source, kind
 * and date when a value exists. Null values render as an honest unavailable
 * sentence naming the item (rule 1: never silently convert missing to zero).
 */
export function factSentence(fact: AskFact, lang: AskLang): string {
  const label = fact.label[lang];
  if (fact.value === null) {
    return lang === "ne"
      ? `${label}: उपलब्ध छैन।`
      : `${label}: not available.`;
  }
  const unit = unitWord(fact.unit, lang);
  const valueWithUnit = unit ? `${fact.value} ${unit}` : `${fact.value}`;
  if (!fact.provenance) {
    return lang === "ne" ? `${label}: ${valueWithUnit}।` : `${label}: ${valueWithUnit}.`;
  }
  const prov = fact.provenance;
  if (prov.kind === "farmer_input") {
    return lang === "ne"
      ? `${label}: ${valueWithUnit}। यो मान तपाईंले दिनुभएको हो।`
      : `${label}: ${valueWithUnit}. You entered this value.`;
  }
  const source = prov.source;
  const nasa = nasaLabel(prov.isNasa, lang);
  const kind = kindWord(prov.kind, lang);
  if (lang === "ne") {
    const dateWord = prov.kind === "forecast" || prov.kind === "cached" ? "लिइएको मिति" : "अवलोकन मिति";
    const date = prov.kind === "forecast" || prov.kind === "cached" ? prov.fetchedAt : (prov.validTo ?? prov.fetchedAt);
    const dateSentence = date ? `${dateWord}: ${date}।` : "मिति उपलब्ध गराइएको छैन।";
    return `${label}: ${valueWithUnit}। स्रोत: ${source}। ${nasa}। प्रकार: ${kind}। ${dateSentence}`;
  }
  const dateWord = prov.kind === "forecast" || prov.kind === "cached" ? "Fetched date" : "Observation date";
  const date = prov.kind === "forecast" || prov.kind === "cached" ? prov.fetchedAt : (prov.validTo ?? prov.fetchedAt);
  const dateSentence = date ? `${dateWord}: ${date}.` : "Date not supplied.";
  return `${label}: ${valueWithUnit}. Source: ${source}. ${nasa}. Kind: ${kind}. ${dateSentence}`;
}
