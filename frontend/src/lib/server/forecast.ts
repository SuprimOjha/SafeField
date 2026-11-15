// Open-Meteo five-day forecast client (port of forecast_client.py). Hourly
// windows are summed over complete future hours in Nepal local time
// (Asia/Kathmandu, UTC+05:45, no DST). Missing or non-consecutive hourly
// periods are never turned into zero precipitation.

import type { DailyForecastItem, FreshnessBadgeData, ForecastResponse } from "@/types/safefield";
import { cacheGet, cacheSet, utcNowIso } from "./cache";
import { fetchJson, sanitizeUpstreamError, withHardDeadline } from "./upstream";

const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";
const OPEN_METEO_DOCS = "https://open-meteo.com/en/docs";
const FORECAST_CACHE_TTL_SECONDS = 3 * 3600;

const NEPAL_OFFSET_MINUTES = 5 * 60 + 45; // UTC+05:45, fixed (no DST)

function finiteNumber(values: unknown[], index: number, min?: number, max?: number): number | null {
  if (index >= values.length || values[index] === null || values[index] === undefined) return null;
  const value = Number(values[index]);
  if (!Number.isFinite(value)) return null;
  if (min !== undefined && value < min) return null;
  if (max !== undefined && value > max) return null;
  return value;
}

function hourlyTotal(hourly: Record<string, unknown>, windowHours: number): number | null {
  const times = Array.isArray(hourly["time"]) ? (hourly["time"] as unknown[]) : [];
  const precipitation = Array.isArray(hourly["precipitation"]) ? (hourly["precipitation"] as unknown[]) : [];
  if (!times.length) return null;

  // "Now" in Kathmandu wall-clock terms. Nepal has a fixed UTC+05:45 offset,
  // so shifting a UTC timestamp by +5:45 and reading its UTC components gives
  // the local wall-clock fields.
  const now = new Date(Date.now() + NEPAL_OFFSET_MINUTES * 60_000);
  const minute = now.getUTCMinutes();
  const second = now.getUTCSeconds();
  const currentHour = Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(), 0, 0, 0,
  );
  const stepHours = minute === 0 && second === 0 ? 1 : 2;
  const firstFutureHour = currentHour + stepHours * 3_600_000;

  const future: { timestamp: number; value: number | null }[] = [];
  for (let index = 0; index < times.length; index++) {
    const parsed = Date.parse(`${String(times[index])}:00Z`) || Date.parse(`${String(times[index])}Z`);
    if (!Number.isFinite(parsed)) continue;
    if (parsed < firstFutureHour) continue;
    future.push({ timestamp: parsed, value: finiteNumber(precipitation, index, 0) });
  }
  future.sort((a, b) => a.timestamp - b.timestamp);
  const window = future.slice(0, windowHours);
  if (window.length !== windowHours || window.some((entry) => entry.value === null)) return null;
  for (let index = 1; index < window.length; index++) {
    if (window[index].timestamp - window[index - 1].timestamp !== 3_600_000) return null;
  }
  const total = window.reduce((acc, entry) => acc + (entry.value as number), 0);
  return Math.round(total * 100) / 100;
}

function badge(status: FreshnessBadgeData["status"], latestDate: string | null, fetchedAt: string, caveat: string): FreshnessBadgeData {
  return {
    dataset_name: "Open-Meteo 5-Day Weather Forecast (Non-NASA)",
    source_org: status === "UNAVAILABLE" ? "Open-Meteo" : "Open-Meteo weather models",
    is_nasa: false,
    status,
    latest_observation_date: latestDate,
    fetched_at_utc: fetchedAt,
    typical_latency: "Frequently updated forecast model runs",
    spatial_resolution: "~9–11 km model grid; selected land cell",
    caveat,
    docs_url: OPEN_METEO_DOCS,
  };
}

export async function get5DayRainForecast(latitude: number, longitude: number): Promise<ForecastResponse> {
  const latR = Math.round(latitude * 100) / 100;
  const lonR = Math.round(longitude * 100) / 100;
  const cacheKey = `open_meteo_forecast:${latR}:${lonR}`;

  const hit = cacheGet<{ response: ForecastResponse; fetchedAt: string }>(cacheKey);
  if (hit) {
    const parsed = { ...hit.response };
    if (parsed.freshness.status === "LIVE") {
      parsed.freshness = { ...parsed.freshness, status: "CACHED_FALLBACK" };
    }
    parsed.freshness = { ...parsed.freshness, fetched_at_utc: hit.fetchedAt };
    return parsed;
  }

  const params = {
    latitude: latR,
    longitude: lonR,
    daily: "precipitation_sum,precipitation_probability_max,temperature_2m_max,temperature_2m_min,wind_speed_10m_max,weather_code,precipitation_hours",
    hourly: "precipitation",
    forecast_days: 5,
    forecast_hours: 126,
    timezone: "Asia/Kathmandu",
    cell_selection: "land",
  };

  try {
    const raw = await withHardDeadline(fetchJson<Record<string, unknown>>(OPEN_METEO_URL, { params, timeoutMs: 12_000, retries: 1 }), 17_000, "Open-Meteo forecast");
    const dailyData = (raw["daily"] as Record<string, unknown>) ?? {};
    const dates = dailyData["time"];
    if (!Array.isArray(dates) || dates.length !== 5) {
      throw new Error("Open-Meteo did not return exactly five daily forecast dates");
    }

    const valuesFor = (key: string): unknown[] => {
      const value = dailyData[key];
      return Array.isArray(value) ? (value as unknown[]) : [];
    };

    const sums = valuesFor("precipitation_sum");
    const probabilities = valuesFor("precipitation_probability_max");
    const maxTemps = valuesFor("temperature_2m_max");
    const minTemps = valuesFor("temperature_2m_min");
    const maxWinds = valuesFor("wind_speed_10m_max");
    const weatherCodes = valuesFor("weather_code");
    const precipitationHours = valuesFor("precipitation_hours");

    const items: DailyForecastItem[] = dates.map((forecastDate, index) => {
      const precip = finiteNumber(sums, index, 0);
      const probability = finiteNumber(probabilities, index, 0, 100);
      const weatherCode = finiteNumber(weatherCodes, index, 0, 99);
      return {
        date: String(forecastDate),
        precipitation_sum_mm: precip === null ? null : Math.round(precip * 100) / 100,
        precipitation_probability_max: probability === null ? null : Math.round(probability),
        temperature_2m_max_c: finiteNumber(maxTemps, index),
        temperature_2m_min_c: finiteNumber(minTemps, index),
        wind_speed_10m_max_kmh: finiteNumber(maxWinds, index, 0),
        weather_code: weatherCode === null ? null : Math.round(weatherCode),
        precipitation_hours: finiteNumber(precipitationHours, index, 0, 24),
      };
    });

    const hourlyData = (raw["hourly"] as Record<string, unknown>) ?? {};
    const next48h = hourlyTotal(hourlyData, 48);
    const next120h = hourlyTotal(hourlyData, 120);
    const rainSoon = next48h === null ? null : next48h > 5.0;

    const fetchedAt = utcNowIso();
    const response: ForecastResponse = {
      latitude: Number.isFinite(Number(raw["latitude"])) ? Number(raw["latitude"]) : latR,
      longitude: Number.isFinite(Number(raw["longitude"])) ? Number(raw["longitude"]) : lonR,
      freshness: badge(
        "LIVE",
        items[0]?.date ?? null,
        fetchedAt,
        "NON-NASA MODEL FORECAST. Daily values are model estimates for the selected grid cell, not field observations. Precipitation includes rain, showers and snow; verify important decisions against local conditions.",
      ),
      forecast_days: items,
      expected_rain_next_48h_mm: next48h,
      expected_rain_next_120h_mm: next120h,
      rain_expected_soon: rainSoon,
    };
    cacheSet(cacheKey, { response, fetchedAt }, FORECAST_CACHE_TTL_SECONDS);
    return response;
  } catch (error) {
    const stale = cacheGet<{ response: ForecastResponse; fetchedAt: string }>(cacheKey);
    if (stale && stale.response.forecast_days.length) {
      return {
        ...stale.response,
        freshness: badge(
          "CACHED_FALLBACK",
          stale.response.freshness.latest_observation_date,
          stale.fetchedAt,
          stale.response.freshness.caveat + " Showing the last successful forecast because the provider is currently unavailable.",
        ),
      };
    }

    const message = String(error);
    const isRateLimited = message.includes("429") || message.toLowerCase().includes("too many requests");
    const caveat = isRateLimited
      ? "Open-Meteo is temporarily rate limiting requests (HTTP 429). No forecast value is assumed. Check local weather and try again later."
      : `Open-Meteo did not return a usable forecast (${sanitizeUpstreamError(error)}). No forecast value is assumed. Check local weather and try again later.`;

    return {
      latitude: latR,
      longitude: lonR,
      freshness: badge("UNAVAILABLE", null, utcNowIso(), caveat + "."),
      forecast_days: [],
      expected_rain_next_48h_mm: null,
      expected_rain_next_120h_mm: null,
      rain_expected_soon: null,
    };
  }
}
