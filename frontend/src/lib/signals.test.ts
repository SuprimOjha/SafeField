import assert from "node:assert/strict";
import test from "node:test";

import {
  assessRainImpact,
  buildFieldSignals,
  buildHeatAirSignal,
  buildRainSignal,
  computeAnomaly,
  rainAgreement,
  SIGNAL_GATES,
} from "./server/signals.ts";
import type {
  DailyWeatherRecord,
  ForecastResponse,
  PowerSummaryResponse,
  RainfallObservation,
  RainfallProvenance,
} from "../types/safefield.ts";
function record(date: string, tempMax: number | null, precip: number | null = null): DailyWeatherRecord {
  return {
    date,
    precip_mm: precip,
    temp_c: tempMax === null ? null : tempMax - 6,
    temp_max_c: tempMax,
    temp_min_c: tempMax === null ? null : tempMax - 12,
    surface_soil_wetness: null,
    root_soil_wetness: null,
  };
}

function summary(records: DailyWeatherRecord[], status: PowerSummaryResponse["freshness"]["status"] = "LIVE"): PowerSummaryResponse {
  return {
    latitude: 26.45,
    longitude: 87.28,
    freshness: {
      dataset_name: "NASA POWER Daily Agroclimatology",
      source_org: "NASA LaRC",
      is_nasa: true,
      status,
      latest_observation_date: records.length ? records[records.length - 1].date : null,
      fetched_at_utc: "2026-11-12T10:00:00+00:00",
      typical_latency: "2-4 days",
      spatial_resolution: "0.5° x 0.625° (~55 km grid cell)",
      caveat: "Gridded model output, not an on-farm gauge.",
      docs_url: "https://power.larc.nasa.gov/",
    },
    rain_last_24h_mm: records.length ? records[records.length - 1].precip_mm : null,
    rain_last_72h_mm: null,
    latest_surface_wetness: null,
    latest_root_wetness: null,
    latest_temp_c: records.length ? records[records.length - 1].temp_c : null,
    recent_daily_records: records.slice(-14),
    historical_daily_records: records,
  };
}

function forecast(rain48h: number | null, status: ForecastResponse["freshness"]["status"] = "LIVE"): ForecastResponse {
  return {
    latitude: 26.45,
    longitude: 87.28,
    freshness: {
      dataset_name: "Open-Meteo 5-Day Weather Forecast (Non-NASA)",
      source_org: "Open-Meteo weather models",
      is_nasa: false,
      status,
      latest_observation_date: null,
      fetched_at_utc: "2026-11-12T10:00:00+00:00",
      typical_latency: "Frequently updated",
      spatial_resolution: "~9-11 km model grid",
      caveat: "Forecast model output, not an observation.",
      docs_url: "https://open-meteo.com/",
    },
    forecast_days: [],
    expected_rain_next_48h_mm: rain48h,
    expected_rain_next_120h_mm: null,
    rain_expected_soon: rain48h !== null ? rain48h > 0 : null,
  };
}

function observation(amount: number | null, endDate = "2026-11-12T00:00:00Z", source = "Open-Meteo Reanalysis Daily Precipitation (non-NASA)"): RainfallObservation {
  if (amount === null) {
    return {
      status: "UNAVAILABLE",
      amount_mm: null,
      window_hours: 72,
      provenance: null,
      unavailable_reason: "No local rainfall observation.",
    };
  }
  const provenance: RainfallProvenance = {
    source_name: source,
    kind: "model",
    observed_start_utc: "2026-11-09T00:00:00Z",
    observed_end_utc: endDate,
    fetched_at_utc: "2026-11-12T10:00:00+00:00",
    spatial_resolution: "~9-11 km reanalysis grid",
    latency_note: "Daily reanalysis.",
    dataset: "ERA5 via Open-Meteo",
    version: "Open-Meteo v1 API",
    granule_ids: [],
    units: "mm",
    spatial_method: "nearest_grid_cell",
    coverage_fraction: null,
  };
  return { status: "AVAILABLE", amount_mm: amount, window_hours: 72, provenance, unavailable_reason: null };
}

function history(year: number, value: number): DailyWeatherRecord[] {
  return [record(`${year}-11-10`, value), record(`${year}-11-11`, value), record(`${year}-11-12`, value)];
}

test("computeAnomaly excludes the target year and requires prior years", () => {
  const series = [2019, 2020, 2021, 2022, 2023, 2024, 2025].flatMap((year) =>
    history(year, 30).map((entry) => ({ date: entry.date, value: entry.temp_max_c ?? null })),
  );
  series.push({ date: "2026-11-12", value: 36 });

  const result = computeAnomaly(series, "2026-11-12", 36);
  assert.equal(result.years_used, 7);
  assert.equal(result.vs_normal, "much_above");
  assert.equal(result.anomaly, 6);

  const short = computeAnomaly(series.slice(0, 6), "2026-11-12", 36);
  assert.equal(short.years_used, 2);
  assert.equal(short.vs_normal, "unknown");
  assert.match(short.reason ?? "", /Not enough prior years/);
});

test("buildRainSignal keeps an unavailable observation blank", () => {
  const signal = buildRainSignal(observation(null));
  assert.equal(signal.status, "unavailable");
  assert.equal(signal.value, null);
  assert.equal(signal.provenance, null);
});

test("buildRainSignal maps provenance and never claims NASA for reanalysis", () => {
  const signal = buildRainSignal(observation(12.5));
  assert.equal(signal.status, "available");
  assert.equal(signal.value, 12.5);
  assert.equal(signal.provenance?.is_nasa, false);
  assert.equal(signal.provenance?.source_key, "open_meteo_past");
  assert.equal(signal.provenance?.valid_date, "2026-11-12");
});

test("rainAgreement needs two estimates on the same window", () => {
  const single = rainAgreement([observation(10)]);
  assert.equal(single.state, "insufficient_sources");

  const differentDates = rainAgreement([observation(10), observation(11, "2026-11-11T00:00:00Z")]);
  assert.equal(differentDates.state, "insufficient_sources");

  const agree = rainAgreement([observation(10), observation(12)]);
  assert.equal(agree.state, "agree");
  assert.equal(agree.spread_mm, 2);

  const disagree = rainAgreement([observation(10), observation(40)]);
  assert.equal(disagree.state, "disagree");
});

test("assessRainImpact does not turn missing data into dry conditions", () => {
  const noDataPower = summary([record("2026-11-12", 30, null)]);
  noDataPower.rain_last_24h_mm = null;
  noDataPower.rain_last_72h_mm = null;
  const unknown = assessRainImpact(noDataPower, forecast(null, "UNAVAILABLE"));
  assert.equal(unknown.classification, "unknown");

  const wetPower = summary([record("2026-11-12", 30, 60)]);
  wetPower.rain_last_24h_mm = 60;
  const heavy = assessRainImpact(wetPower, forecast(0));
  assert.equal(heavy.classification, "heavy_recent");
  assert.equal(heavy.thresholds.rain_heavy_24h_mm, SIGNAL_GATES.rainHeavy24hMm);
});

test("buildHeatAirSignal reports T2M_MAX provenance and cached status", () => {
  const records = [...[2019, 2020, 2021, 2022, 2023, 2024, 2025].flatMap((year) => history(year, 30)), record("2026-11-12", 36)];
  const live = buildHeatAirSignal(summary(records));
  assert.equal(live.status, "available");
  assert.equal(live.value, 36);
  assert.equal(live.provenance?.kind, "model");
  assert.equal(live.provenance?.is_nasa, true);
  assert.equal(live.vs_normal, "much_above");

  const cached = buildHeatAirSignal(summary(records, "CACHED_FALLBACK"));
  assert.equal(cached.status, "stale");
  assert.equal(cached.provenance?.kind, "cached");
  assert.match(cached.quality_note ?? "", /not live data/);
});

test("buildFieldSignals surfaces not-installed satellite signals instead of substitutes", () => {
  const records = [...[2019, 2020, 2021, 2022, 2023, 2024, 2025].flatMap((year) => history(year, 30)), record("2026-11-12", 30)];
  const output = buildFieldSignals({
    latitude: 26.45,
    longitude: 87.28,
    summary: summary(records),
    forecast: forecast(0),
    observation: observation(10),
    now: new Date("2026-11-12T12:00:00Z"),
  });

  assert.equal(output.signals.signals.rain?.status, "available");
  assert.equal(output.signals.signals.heat_air?.status, "available");
  for (const name of ["soil_moisture_surface", "soil_moisture_root", "heat_surface", "ndvi", "evi"] as const) {
    assert.equal(output.signals.signals[name]?.status, "not_installed", name);
    assert.equal(output.signals.signals[name]?.value, null, name);
  }
  assert.equal(output.signals.generated_at, "2026-11-12T12:00:00Z");
  assert.equal(output.rain_agreement.state, "insufficient_sources");
  assert.equal(output.stress_watch.overall, "unknown");
  assert.deepEqual(
    output.stress_watch.factors.map((factor) => factor.factor),
    ["water", "heat", "vegetation", "rain"],
  );
});
