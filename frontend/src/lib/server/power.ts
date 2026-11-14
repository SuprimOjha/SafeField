// NASA POWER daily agroclimatology client (TypeScript port of the Python
// power_client.py contract). Returns the same PowerSummaryResponse shape the
// frontend already consumes. Missing/unassimilated POWER days (-999 fill) are
// dropped; no value is ever substituted.

import type { DailyWeatherRecord, FreshnessBadgeData, PowerSummaryResponse } from "@/types/safefield";
import { cacheGet, cacheSet, utcNowIso } from "./cache";
import { fetchJson } from "./upstream";

const POWER_DAILY_ENDPOINT = "https://power.larc.nasa.gov/api/temporal/daily/point";
const POWER_DOCS_URL = "https://power.larc.nasa.gov/docs/services/api/";
const POWER_FILL_THRESHOLD = -900.0; // NASA POWER uses -999 for missing/unassimilated days
const POWER_CACHE_TTL_SECONDS = 6 * 3600;

function cleanPowerVal(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const val = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(val)) return null;
  if (val <= POWER_FILL_THRESHOLD) return null;
  return Math.round(val * 1000) / 1000;
}

function formatYyyymmddToIso(yyyymmdd: string): string {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

function freshness(
  status: FreshnessBadgeData["status"],
  latestDate: string | null,
  fetchedAt: string,
  caveat: string,
): FreshnessBadgeData {
  return {
    dataset_name: "NASA POWER Daily Agroclimatology (PRECTOTCORR, T2M, GWETTOP, GWETROOT)",
    source_org: "NASA Langley Research Center (LaRC)",
    is_nasa: true,
    status,
    latest_observation_date: latestDate,
    fetched_at_utc: fetchedAt,
    typical_latency: "2-4 days (gridded assimilation lag)",
    spatial_resolution: "0.5° x 0.625° (~55 km grid cell)",
    caveat,
    docs_url: POWER_DOCS_URL,
  };
}

function parsePowerResponse(
  latitude: number,
  longitude: number,
  rawJson: Record<string, unknown>,
  fetchedAtUtc: string,
  status: FreshnessBadgeData["status"],
): PowerSummaryResponse {
  const paramBlock = ((rawJson["properties"] as Record<string, unknown>) ?? {})["parameter"] as
    | Record<string, Record<string, unknown>>
    | undefined;
  const precipMap = paramBlock?.["PRECTOTCORR"] ?? {};
  const tempMap = paramBlock?.["T2M"] ?? {};
  const gwettopMap = paramBlock?.["GWETTOP"] ?? {};
  const gwetrootMap = paramBlock?.["GWETROOT"] ?? {};

  const allDates = Object.keys(precipMap).sort();
  const records: DailyWeatherRecord[] = [];

  for (const dStr of allDates) {
    const pVal = cleanPowerVal(precipMap[dStr]);
    const tVal = cleanPowerVal(tempMap[dStr]);
    const topVal = cleanPowerVal(gwettopMap[dStr]);
    const rootVal = cleanPowerVal(gwetrootMap[dStr]);

    // Skip trailing dates where NASA POWER has not yet assimilated data (-999)
    if (pVal === null && tVal === null && topVal === null) continue;

    records.push({
      date: formatYyyymmddToIso(dStr),
      precip_mm: pVal,
      temp_c: tVal,
      surface_soil_wetness: topVal,
      root_soil_wetness: rootVal,
    });
  }

  const latestDate = records.length ? records[records.length - 1].date : null;
  const recentRecords = records.slice(-14);

  // Compute recent 24h (latest valid day) and 72h (latest 3 consecutive valid days)
  const validPrecipDays = records.slice(-7).filter((r) => r.precip_mm !== null);
  const rain24h = validPrecipDays.length >= 1 && validPrecipDays[validPrecipDays.length - 1].precip_mm !== null
    ? Math.round((validPrecipDays[validPrecipDays.length - 1].precip_mm as number) * 100) / 100
    : null;

  let rain72h: number | null = null;
  if (validPrecipDays.length >= 3) {
    const lastThree = validPrecipDays.slice(-3);
    const dates = lastThree.map((record) => new Date(record.date + "T00:00:00Z").getTime());
    const oneDay = 24 * 60 * 60 * 1000;
    if (dates[1] - dates[0] === oneDay && dates[2] - dates[1] === oneDay) {
      const total = lastThree.reduce((acc, record) => acc + (record.precip_mm ?? 0), 0);
      rain72h = Math.round(total * 100) / 100;
    }
  }

  const latestRec = records.length ? records[records.length - 1] : null;

  return {
    latitude,
    longitude,
    freshness: freshness(
      status,
      latestDate,
      fetchedAtUtc,
      "Gridded reanalysis/satellite-assimilated model output (~55 km cell), not an on-farm rain gauge or soil probe.",
    ),
    rain_last_24h_mm: rain24h,
    rain_last_72h_mm: rain72h,
    latest_surface_wetness: latestRec ? latestRec.surface_soil_wetness : null,
    latest_root_wetness: latestRec ? latestRec.root_soil_wetness : null,
    latest_temp_c: latestRec ? latestRec.temp_c : null,
    recent_daily_records: recentRecords,
    historical_daily_records: records,
  };
}

function unavailableSummary(latitude: number, longitude: number, reason: string): PowerSummaryResponse {
  return {
    latitude,
    longitude,
    freshness: freshness("UNAVAILABLE", null, utcNowIso(), `UNAVAILABLE: Could not reach NASA POWER API (${reason}).`),
    rain_last_24h_mm: null,
    rain_last_72h_mm: null,
    latest_surface_wetness: null,
    latest_root_wetness: null,
    latest_temp_c: null,
    recent_daily_records: [],
    historical_daily_records: [],
  };
}

export async function getFieldWeatherAndHistory(
  latitude: number,
  longitude: number,
  historyYears = 10,
): Promise<PowerSummaryResponse> {
  // Round coordinates to 2 decimals (~1.1 km) for cache efficiency; POWER grid is ~55 km
  const latR = Math.round(latitude * 100) / 100;
  const lonR = Math.round(longitude * 100) / 100;
  const cacheKey = `nasa_power_daily:${latR}:${lonR}:y${historyYears}`;

  const freshHit = cacheGet<{ summary: PowerSummaryResponse; fetchedAt: string }>(cacheKey);
  if (freshHit) {
    const parsed = { ...freshHit.summary };
    parsed.freshness = { ...parsed.freshness, status: "CACHED_FALLBACK", fetched_at_utc: freshHit.fetchedAt };
    return parsed;
  }

  const todayUtc = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const startYear = Math.max(1981, Number(todayUtc.slice(0, 4)) - historyYears);
  const startStr = `${startYear}0101`;

  try {
    const rawJson = await fetchJson<Record<string, unknown>>(POWER_DAILY_ENDPOINT, {
      params: {
        parameters: "PRECTOTCORR,T2M,GWETTOP,GWETROOT",
        community: "AG",
        longitude: lonR,
        latitude: latR,
        start: startStr,
        end: todayUtc,
        format: "JSON",
      },
      timeoutMs: 25_000,
      retries: 1,
    });
    const fetchedAt = utcNowIso();
    const summary = parsePowerResponse(latR, lonR, rawJson, fetchedAt, "LIVE");
    cacheSet(cacheKey, { summary, fetchedAt }, POWER_CACHE_TTL_SECONDS);
    return summary;
  } catch (error) {
    const staleHit = cacheGet<{ summary: PowerSummaryResponse; fetchedAt: string }>(cacheKey);
    if (staleHit) {
      const parsed = { ...staleHit.summary };
      parsed.freshness = {
        ...parsed.freshness,
        status: "CACHED_FALLBACK",
        fetched_at_utc: staleHit.fetchedAt,
        caveat: `Showing cached NASA POWER data (upstream unreachable: ${String(error)}). ${parsed.freshness.caveat}`,
      };
      return parsed;
    }
    return unavailableSummary(latR, lonR, String(error));
  }
}
