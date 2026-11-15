// Field signal assembly for the deployed Next.js route. This mirrors the
// Python signal framework (backend/app/signals) so the standalone deployment
// can show the same provenance envelope, versus-normal classes, source
// agreement, rain impact and stress screening without depending on the
// FastAPI service. Rules are identical; a value is never invented. Signals
// that need installed satellite snapshots (SMAP, LST, NDVI/EVI) report
// not_installed here because those snapshots are published on the data branch
// and are not bundled with the app.

import type {
  AgreementSource,
  DailyWeatherRecord,
  ForecastResponse,
  PowerSummaryResponse,
  RainImpact,
  RainfallObservation,
  SignalBundle,
  SignalProvenance,
  SignalValue,
  SourceAgreement,
  StressFactor,
  StressWatch,
  VsNormal,
} from "@/types/safefield";

export const ASSUMPTION_NOTE = "Design assumption, pending review by a Nepali agronomist.";

// Mirrors backend/app/signals/config.py defaults. Changing a value here
// without changing the backend (or content/signal_gates.json) would make the
// two deployments disagree.
export const SIGNAL_GATES = {
  anomalyWindowDays: 7,
  anomalyMinYears: 3,
  muchBelowPercentile: 10,
  belowPercentile: 25,
  abovePercentile: 75,
  muchAbovePercentile: 90,
  heatDayMaxC: 35,
  rainHeavy24hMm: 50,
  rainHeavy72hMm: 80,
  rainHeavyForecastMm: 10,
  agreementRainAbsMm: 5,
  agreementRainRelFraction: 0.5,
} as const;

type Gates = typeof SIGNAL_GATES;

function dayNumber(iso: string): number {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  return Math.round((Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 0)) / 86_400_000);
}

function yearOf(iso: string): number {
  return Number(iso.slice(0, 4));
}

function mean(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function calendarDistance(left: string, right: string): number {
  const difference = Math.abs(dayNumber(left) - dayNumber(right));
  return Math.min(difference, 366 - difference);
}

export interface AnomalyResult {
  vs_normal: VsNormal;
  baseline: number | null;
  anomaly: number | null;
  years_used: number;
  percentile_rank: number | null;
  reason: string | null;
}

function classifyPercentile(percentile: number, gates: Gates): VsNormal {
  if (percentile <= gates.muchBelowPercentile) return "much_below";
  if (percentile <= gates.belowPercentile) return "below";
  if (percentile < gates.abovePercentile) return "near_normal";
  if (percentile < gates.muchAbovePercentile) return "above";
  return "much_above";
}

export function computeAnomaly(
  series: { date: string; value: number | null }[],
  targetDate: string,
  targetValue: number | null,
  gates: Gates = SIGNAL_GATES,
): AnomalyResult {
  // The baseline is the median of yearly means inside the same calendar
  // window across prior years. The target year is excluded so a value is never
  // compared with itself, and a year only contributes when it has data.
  const yearlyValues = new Map<number, number[]>();
  for (const entry of series) {
    if (entry.value === null) continue;
    if (yearOf(entry.date) === yearOf(targetDate)) continue;
    if (calendarDistance(entry.date, targetDate) > gates.anomalyWindowDays) continue;
    const values = yearlyValues.get(yearOf(entry.date)) ?? [];
    values.push(entry.value);
    yearlyValues.set(yearOf(entry.date), values);
  }

  const baseline = [...yearlyValues.values()].map(mean);
  const yearsUsed = baseline.length;
  if (yearsUsed < gates.anomalyMinYears) {
    return {
      vs_normal: "unknown",
      baseline: null,
      anomaly: null,
      years_used: yearsUsed,
      percentile_rank: null,
      reason: `Not enough prior years for a normal: ${yearsUsed} year(s) with data inside the ±${gates.anomalyWindowDays}-day calendar window; ${gates.anomalyMinYears} are required.`,
    };
  }
  if (targetValue === null) {
    return {
      vs_normal: "unknown",
      baseline: round(median(baseline)),
      anomaly: null,
      years_used: yearsUsed,
      percentile_rank: null,
      reason: "No current value is available to compare with the normal.",
    };
  }

  const below = baseline.filter((item) => item < targetValue).length;
  const equal = baseline.filter((item) => item === targetValue).length;
  const percentile = (100 * (below + 0.5 * equal)) / baseline.length;
  const baselineMedian = median(baseline);
  return {
    vs_normal: classifyPercentile(percentile, gates),
    baseline: round(baselineMedian),
    anomaly: round(targetValue - baselineMedian),
    years_used: yearsUsed,
    percentile_rank: round(percentile, 1),
    reason: `Compared with ${yearsUsed} prior year(s) within ±${gates.anomalyWindowDays} calendar days. Versus-normal class is a software classification assumption, not an agronomic threshold.`,
  };
}

function isNasaSource(sourceName: string): boolean {
  // Several honest provenance strings say "(non-NASA)", so remove the
  // negation before testing; otherwise the NASA flag would be wrong.
  const lower = sourceName.toLowerCase().replace(/non[- ]?nasa/g, "");
  return lower.includes("nasa") || lower.includes("imerg");
}

export function buildRainSignal(observation: RainfallObservation): SignalValue {
  if (observation.status !== "AVAILABLE" || observation.amount_mm === null || !observation.provenance) {
    return {
      name: "rain",
      status: "unavailable",
      value: null,
      unit: null,
      vs_normal: "unknown",
      anomaly: null,
      baseline: null,
      baseline_years: 0,
      provenance: null,
      unavailable_reason:
        observation.unavailable_reason ?? "No local rainfall observation is available for the requested window.",
      quality_note: null,
    };
  }

  const source = observation.provenance;
  const nasa = isNasaSource(source.source_name);
  const caveat =
    source.kind === "observation" && nasa
      ? "Satellite rainfall estimate for the area around the field, not a rain gauge in the plot. Pixel resolution limits how precisely a small field is represented."
      : "Model or reanalysis rainfall estimate for the area around the field, not a rain gauge in the plot. It may differ from what fell on the field.";

  const provenance: SignalProvenance = {
    source_name: source.source_name,
    product: source.dataset,
    version: source.version,
    kind: source.kind,
    is_nasa: nasa,
    valid_date: source.observed_end_utc.slice(0, 10),
    observed_start: source.observed_start_utc,
    observed_end: source.observed_end_utc,
    fetched_at: source.fetched_at_utc,
    spatial_resolution: source.spatial_resolution ?? "not reported by provider",
    latency_note: source.latency_note,
    granule_ids: source.granule_ids,
    coverage_fraction: source.coverage_fraction,
    source_key: nasa ? "imerg" : "open_meteo_past",
    caveat,
  };

  return {
    name: "rain",
    status: "available",
    value: round(observation.amount_mm, 2),
    unit: `mm over ${observation.window_hours} h`,
    vs_normal: "unknown",
    anomaly: null,
    baseline: null,
    baseline_years: 0,
    provenance,
    unavailable_reason: null,
    quality_note: null,
  };
}

export function countHeatDays(records: DailyWeatherRecord[], thresholdC: number, windowDays: number): { hot: number; observed: number } {
  const pairs = records
    .filter((record) => record.temp_max_c !== null && record.temp_max_c !== undefined)
    .map((record) => ({ day: dayNumber(record.date), value: record.temp_max_c as number }));
  if (!pairs.length) return { hot: 0, observed: 0 };
  const latest = Math.max(...pairs.map((pair) => pair.day));
  const cutoff = latest - (windowDays - 1);
  const observed = pairs.filter((pair) => pair.day >= cutoff && pair.day <= latest);
  return { hot: observed.filter((pair) => pair.value >= thresholdC).length, observed: observed.length };
}

export function buildHeatAirSignal(summary: PowerSummaryResponse, gates: Gates = SIGNAL_GATES): SignalValue {
  const unavailable = (reason: string): SignalValue => ({
    name: "heat_air",
    status: "unavailable",
    value: null,
    unit: null,
    vs_normal: "unknown",
    anomaly: null,
    baseline: null,
    baseline_years: 0,
    provenance: null,
    unavailable_reason: reason,
    quality_note: null,
  });

  if (summary.freshness.status === "UNAVAILABLE") {
    return unavailable(`NASA POWER did not return air temperature for this location. ${summary.freshness.caveat}`);
  }
  const records = summary.historical_daily_records.filter(
    (record) => record.temp_max_c !== null && record.temp_max_c !== undefined,
  );
  if (!records.length) {
    return unavailable("NASA POWER returned no T2M_MAX daily maximum temperature for this location.");
  }

  const latest = records[records.length - 1];
  const latestDate = latest.date;
  const cached = summary.freshness.status === "CACHED_FALLBACK";
  const { hot, observed } = countHeatDays(records, gates.heatDayMaxC, gates.anomalyWindowDays);
  const anomaly = computeAnomaly(
    records.map((record) => ({ date: record.date, value: record.temp_max_c as number })),
    latestDate,
    latest.temp_max_c as number,
    gates,
  );

  const notes = [
    `Daily maximum air temperature. In the last ${gates.anomalyWindowDays} days with a value, ${hot} of ${observed} reached the ${gates.heatDayMaxC} °C heat-day screening level (${ASSUMPTION_NOTE}).`,
  ];
  if (cached) notes.push("Showing the last cached NASA POWER response; this is not live data.");
  if (anomaly.reason) notes.push(anomaly.reason);

  return {
    name: "heat_air",
    status: cached ? "stale" : "available",
    value: round(latest.temp_max_c as number, 2),
    unit: "°C (daily maximum air temperature at 2 m)",
    vs_normal: anomaly.vs_normal,
    anomaly: anomaly.anomaly,
    baseline: anomaly.baseline,
    baseline_years: anomaly.years_used,
    provenance: {
      source_name: summary.freshness.dataset_name,
      product: "NASA POWER Daily Agroclimatology, T2M_MAX",
      version: "not reported by provider",
      kind: cached ? "cached" : "model",
      is_nasa: summary.freshness.is_nasa,
      valid_date: latestDate,
      observed_start: null,
      observed_end: null,
      fetched_at: summary.freshness.fetched_at_utc,
      spatial_resolution: summary.freshness.spatial_resolution,
      latency_note: summary.freshness.typical_latency,
      granule_ids: [],
      coverage_fraction: null,
      source_key: "power",
      caveat: summary.freshness.caveat,
    },
    unavailable_reason: null,
    quality_note: notes.join(" "),
  };
}

function notInstalled(name: SignalValue["name"], reason: string): SignalValue {
  return {
    name,
    status: "not_installed",
    value: null,
    unit: null,
    vs_normal: "unknown",
    anomaly: null,
    baseline: null,
    baseline_years: 0,
    provenance: null,
    unavailable_reason: reason,
    quality_note: null,
  };
}

export function rainAgreement(observations: RainfallObservation[], gates: Gates = SIGNAL_GATES): SourceAgreement {
  const available = observations.filter(
    (observation) =>
      observation.status === "AVAILABLE" && observation.amount_mm !== null && observation.provenance !== null,
  );
  if (available.length < 2) {
    return {
      topic: "rain",
      state: "insufficient_sources",
      sources: [],
      spread_mm: null,
      tolerance_note: "",
      summary: `Only ${available.length} independent rainfall estimate(s) are available. At least two are required to compare sources.`,
      assumption_note:
        "Agreement classes compare estimates on the same window. They are a software classification assumption, not an agronomic threshold, and do not prove that either estimate is correct.",
    };
  }

  // Estimates ending on different dates, or covering different window
  // lengths, are never compared: a difference between two windows would say
  // nothing about source agreement.
  const groups = new Map<string, RainfallObservation[]>();
  for (const observation of available) {
    const provenance = observation.provenance;
    if (!provenance) continue;
    const key = `${provenance.observed_end_utc.slice(0, 10)}|${observation.window_hours}`;
    groups.set(key, [...(groups.get(key) ?? []), observation]);
  }
  const [key, group] = [...groups.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  const [endDate, windowHours] = key.split("|");
  const sources: AgreementSource[] = group.map((observation) => ({
    source_name: observation.provenance?.source_name ?? "unknown",
    amount_mm: Number(observation.amount_mm),
    kind: observation.provenance?.kind ?? "model",
    is_nasa: isNasaSource(observation.provenance?.source_name ?? ""),
    window_hours: observation.window_hours,
    observed_end_date: endDate,
    spatial_resolution: observation.provenance?.spatial_resolution ?? null,
  }));
  if (sources.length < 2) {
    return {
      topic: "rain",
      state: "insufficient_sources",
      sources,
      spread_mm: null,
      tolerance_note: "",
      summary: `Only one rainfall estimate ends on ${endDate} for a ${windowHours}-hour window. Estimates on different dates are not compared.`,
      assumption_note:
        "Agreement classes compare estimates on the same window. They are a software classification assumption, not an agronomic threshold, and do not prove that either estimate is correct.",
    };
  }

  const values = sources.map((source) => source.amount_mm);
  const spread = Math.max(...values) - Math.min(...values);
  const tolerance = Math.max(gates.agreementRainAbsMm, gates.agreementRainRelFraction * mean(values));
  const toleranceNote = `Compared on the same ${windowHours}-hour window ending ${endDate}. Spread of ${spread.toFixed(1)} mm; the software tolerance is the larger of ${gates.agreementRainAbsMm} mm or ${Math.round(gates.agreementRainRelFraction * 100)}% of the mean (${tolerance.toFixed(1)} mm).`;
  let state: SourceAgreement["state"];
  let summary: string;
  if (spread <= tolerance) {
    state = "agree";
    summary = "Independent rainfall estimates broadly agree on this window.";
  } else if (spread <= 2 * tolerance) {
    state = "partial";
    summary = "Independent rainfall estimates partly agree; expect local differences.";
  } else {
    state = "disagree";
    summary =
      "Independent rainfall estimates disagree on this window. Do not treat either estimate as verification of field rainfall.";
  }

  return {
    topic: "rain",
    state,
    sources,
    spread_mm: round(spread, 2),
    tolerance_note: toleranceNote,
    summary,
    assumption_note:
      "Agreement classes compare estimates on the same window. They are a software classification assumption, not an agronomic threshold, and do not prove that either estimate is correct.",
  };
}

export function assessRainImpact(
  summary: PowerSummaryResponse | null,
  forecast: ForecastResponse | null,
  gates: Gates = SIGNAL_GATES,
): RainImpact {
  const thresholds = {
    rain_heavy_24h_mm: gates.rainHeavy24hMm,
    rain_heavy_72h_mm: gates.rainHeavy72hMm,
    rain_heavy_forecast_mm: gates.rainHeavyForecastMm,
  };
  const assumptionNote = `Depth cut-offs are ${gates.rainHeavy24hMm} mm in 24 h, ${gates.rainHeavy72hMm} mm in 72 h and ${gates.rainHeavyForecastMm} mm forecast in 48 h: ${ASSUMPTION_NOTE} They are screening aids, not flood or crop-damage thresholds.`;

  const powerOk = summary !== null && summary.freshness.status !== "UNAVAILABLE";
  const rain24h = powerOk ? summary.rain_last_24h_mm : null;
  const rain72h = powerOk ? summary.rain_last_72h_mm : null;
  const forecast48h =
    forecast !== null && forecast.freshness.status !== "UNAVAILABLE" ? forecast.expected_rain_next_48h_mm : null;

  const recentHeavy =
    (rain24h !== null && rain24h >= gates.rainHeavy24hMm) || (rain72h !== null && rain72h >= gates.rainHeavy72hMm);
  const forecastHeavy = forecast48h !== null && forecast48h >= gates.rainHeavyForecastMm;

  if (recentHeavy) {
    return {
      classification: "heavy_recent",
      rain_24h_mm: rain24h,
      rain_72h_mm: rain72h,
      forecast_48h_mm: forecast48h,
      thresholds,
      summary:
        "Recent rain reaches the screening depth on the coarse NASA POWER grid. Check drainage and local field conditions; this is not a flood warning.",
      assumption_note: assumptionNote,
    };
  }
  if (forecastHeavy) {
    return {
      classification: "heavy_forecast",
      rain_24h_mm: rain24h,
      rain_72h_mm: rain72h,
      forecast_48h_mm: forecast48h,
      thresholds,
      summary:
        "The non-NASA forecast expects rain above the screening depth in the next 48 hours. Recheck before field operations; forecasts can change.",
      assumption_note: assumptionNote,
    };
  }
  if (rain24h === null && rain72h === null && forecast48h === null) {
    return {
      classification: "unknown",
      rain_24h_mm: null,
      rain_72h_mm: null,
      forecast_48h_mm: null,
      thresholds,
      summary: "No recent or forecast rain value is available. Missing data is not treated as dry conditions.",
      assumption_note: assumptionNote,
    };
  }
  return {
    classification: "none",
    rain_24h_mm: rain24h,
    rain_72h_mm: rain72h,
    forecast_48h_mm: forecast48h,
    thresholds,
    summary:
      "Available rain values are below the screening depths. This does not prove that fields are dry or that irrigation is needed.",
    assumption_note: assumptionNote,
  };
}

const BELOW = new Set<VsNormal>(["below", "much_below"]);
const ABOVE = new Set<VsNormal>(["above", "much_above"]);

function factorFromSignals(signals: SignalValue[], watching: Set<VsNormal>): { state: StressFactor["state"]; evidence: string[]; reason: string } {
  if (!signals.length) return { state: "unknown", evidence: [], reason: "No signal was supplied for this factor." };
  const evidence: string[] = [];
  const unavailable: string[] = [];
  for (const signal of signals) {
    if (signal.status === "unavailable" || signal.status === "not_installed") {
      unavailable.push(`${signal.name}: ${signal.unavailable_reason ?? "unavailable"}`);
      continue;
    }
    if (watching.has(signal.vs_normal)) {
      const day = signal.provenance?.valid_date ?? "unknown date";
      evidence.push(`${signal.name} is ${signal.vs_normal.replace("_", " ")} vs normal (valid ${day}).`);
    }
  }
  if (evidence.length) {
    return { state: "watch", evidence, reason: "At least one available signal is outside the local normal range." };
  }
  const missingOrUnknown = signals
    .filter((signal) => signal.status === "unavailable" || signal.status === "not_installed" || signal.vs_normal === "unknown")
    .map((signal) => signal.name);
  if (missingOrUnknown.length) {
    return {
      state: "unknown",
      evidence: unavailable,
      reason: `Versus-normal status is unknown or unavailable for: ${missingOrUnknown.join(", ")}. Missing data is not treated as normal.`,
    };
  }
  return { state: "no_watch", evidence: [], reason: "Available signals are inside the local normal range." };
}

export function buildStressWatch(
  bundle: SignalBundle,
  summary: PowerSummaryResponse | null,
  impact: RainImpact | null,
  gates: Gates = SIGNAL_GATES,
): StressWatch {
  const factors: StressFactor[] = [];

  const waterSignals = [bundle.signals.soil_moisture_root, bundle.signals.soil_moisture_surface].filter(
    (signal): signal is SignalValue => Boolean(signal),
  );
  const water = factorFromSignals(waterSignals, BELOW);
  factors.push({ factor: "water", state: water.state, evidence: water.evidence, reason: water.reason });

  const heatSignals = [bundle.signals.heat_air].filter((signal): signal is SignalValue => Boolean(signal));
  const heat = factorFromSignals(heatSignals, ABOVE);
  if (summary !== null && summary.freshness.status !== "UNAVAILABLE") {
    const { hot, observed } = countHeatDays(summary.historical_daily_records, gates.heatDayMaxC, gates.anomalyWindowDays);
    if (hot > 0) {
      heat.state = "watch";
      heat.evidence.push(
        `${hot} of ${observed} recent days reached the ${gates.heatDayMaxC} °C heat-day screening level (${ASSUMPTION_NOTE}).`,
      );
      heat.reason = "Recent daily maximum air temperature crossed the screening level.";
    }
  }
  const surface = bundle.signals.heat_surface;
  if (heat.state !== "watch" && surface && ABOVE.has(surface.vs_normal)) {
    heat.state = "watch";
    heat.evidence.push(
      `Daytime surface skin temperature is ${surface.vs_normal.replace("_", " ")} vs normal (a surface quantity, not air temperature).`,
    );
    heat.reason = "Surface temperature is above the local normal range; check the crop.";
  }
  factors.push({ factor: "heat", state: heat.state, evidence: heat.evidence, reason: heat.reason });

  const vegSignals = [bundle.signals.ndvi].filter((signal): signal is SignalValue => Boolean(signal));
  const vegetation = factorFromSignals(vegSignals, BELOW);
  factors.push({ factor: "vegetation", state: vegetation.state, evidence: vegetation.evidence, reason: vegetation.reason });

  let rainState: StressFactor["state"];
  let rainReason: string;
  if (impact === null) {
    rainState = "unknown";
    rainReason = "Rain impact was not assessed for this field.";
  } else if (impact.classification === "heavy_recent" || impact.classification === "heavy_forecast") {
    rainState = "watch";
    rainReason = impact.summary;
  } else if (impact.classification === "none") {
    rainState = "no_watch";
    rainReason = impact.summary;
  } else {
    rainState = "unknown";
    rainReason = impact.summary;
  }
  factors.push({
    factor: "rain",
    state: rainState,
    evidence: impact ? [impact.summary] : [],
    reason: rainReason,
  });

  const states = factors.map((factor) => factor.state);
  let overall: StressWatch["overall"];
  let summaryText: string;
  if (states.includes("watch")) {
    overall = "watch";
    summaryText =
      "At least one screening factor flagged a reason to check the field. This is not a diagnosis and does not prescribe an input.";
  } else if (states.includes("unknown")) {
    overall = "unknown";
    summaryText =
      "No factor flagged a watch, but some signals are unavailable or lack a local normal. Missing data is not treated as normal.";
  } else {
    overall = "no_watch";
    summaryText =
      "No screening factor crossed its class using the available signals. This does not certify the crop as healthy or stress-free.";
  }

  return {
    overall,
    factors,
    summary: summaryText,
    disclaimer:
      "Screening only. This is not a crop diagnosis, does not rule out stress, and is not a recommendation to apply water, fertilizer or pesticide. Confirm with local observation and a qualified extension worker.",
  };
}

export interface FieldSignalInput {
  latitude: number;
  longitude: number;
  summary: PowerSummaryResponse;
  forecast: ForecastResponse;
  observation: RainfallObservation;
  now?: Date;
}

export interface FieldSignalOutput {
  signals: SignalBundle;
  rain_agreement: SourceAgreement;
  rain_impact: RainImpact;
  stress_watch: StressWatch;
}

const SATELLITE_NOT_INSTALLED = {
  soil_moisture_surface:
    "No SMAP L4 snapshot is installed in this deployment. NASA POWER surface wetness is a different quantity and is not substituted for satellite soil moisture.",
  soil_moisture_root:
    "No SMAP L4 snapshot is installed in this deployment. NASA POWER root-zone wetness is a different quantity and is not substituted for satellite soil moisture.",
  heat_surface:
    "No MODIS/VIIRS land-surface-temperature snapshot is installed in this deployment. Air temperature is shown separately and is not a surface-skin value.",
  ndvi: "No MODIS NDVI composite snapshot is installed in this deployment.",
  evi: "No MODIS EVI composite snapshot is installed in this deployment.",
} as const;

export function buildFieldSignals(input: FieldSignalInput): FieldSignalOutput {
  const { latitude, longitude, summary, forecast, observation } = input;
  const signals: Record<string, SignalValue> = {
    rain: buildRainSignal(observation),
    soil_moisture_surface: notInstalled("soil_moisture_surface", SATELLITE_NOT_INSTALLED.soil_moisture_surface),
    soil_moisture_root: notInstalled("soil_moisture_root", SATELLITE_NOT_INSTALLED.soil_moisture_root),
    heat_air: buildHeatAirSignal(summary),
    heat_surface: notInstalled("heat_surface", SATELLITE_NOT_INSTALLED.heat_surface),
    ndvi: notInstalled("ndvi", SATELLITE_NOT_INSTALLED.ndvi),
    evi: notInstalled("evi", SATELLITE_NOT_INSTALLED.evi),
  };

  const warnings = Object.values(signals)
    .filter((signal) => signal.status === "unavailable" || signal.status === "not_installed")
    .map((signal) => `${signal.name}: ${signal.status} — ${signal.unavailable_reason}`);

  const bundle: SignalBundle = {
    latitude,
    longitude,
    generated_at: (input.now ?? new Date()).toISOString().replace(/\.\d{3}Z$/, "Z"),
    signals: signals as SignalBundle["signals"],
    warnings,
  };

  const agreement = rainAgreement([observation]);
  const impact = assessRainImpact(summary, forecast);
  const stress = buildStressWatch(bundle, summary, impact);
  return { signals: bundle, rain_agreement: agreement, rain_impact: impact, stress_watch: stress };
}
