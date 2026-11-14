import { FieldAssessmentResponse } from "@/types/safefield";

const DEFAULT_PRODUCTION_API_URL = "https://safefield-nepal-spaceapps-2026.onrender.com";
const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  (process.env.NODE_ENV === "production" ? DEFAULT_PRODUCTION_API_URL : "http://127.0.0.1:8000");
const STORAGE_PREFIX = "safefield_cache_v2:";
const MAX_OFFLINE_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const ASSESSMENT_REQUEST_TIMEOUT_MS = 45_000;

interface CachedAssessment {
  cached_at_utc: string;
  data: FieldAssessmentResponse;
}

function readOfflineAssessment(cacheKey: string): FieldAssessmentResponse | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(cacheKey);
    if (!raw) return null;

    const cached = JSON.parse(raw) as CachedAssessment;
    if (!cached || typeof cached !== "object" || !cached.data || !cached.cached_at_utc) return null;

    const cachedAt = Date.parse(cached.cached_at_utc);
    if (!Number.isFinite(cachedAt) || Date.now() - cachedAt > MAX_OFFLINE_CACHE_AGE_MS || cachedAt > Date.now()) {
      return null;
    }

    const data = cached.data;
    for (const source of [data.power_summary, data.elevation, data.soil_texture, data.forecast]) {
      source.freshness.status = "CACHED_FALLBACK";
      source.freshness.caveat += ` Browser offline cache captured at ${cached.cached_at_utc}; the source observation time is unchanged.`;
    }
    if (data.rainfall_observation.provenance) {
      data.rainfall_observation.provenance.kind = "fallback";
      data.rainfall_observation.provenance.latency_note += " Browser local cache fallback; original observation timestamps are unchanged.";
    }
    return data;
  } catch {
    // Storage can be disabled, quota-limited, or contain malformed JSON.
    return null;
  }
}

export async function fetchFieldAssessment(
  lat: number,
  lon: number,
  fertilizerType: string = "Urea",
  cropStage: string = "Vegetative / Tillering",
  saveMoney: boolean = true,
  sandPercentOverride: number | null = null,
  fieldPolygon: [number, number][] | null = null
): Promise<FieldAssessmentResponse> {
  const url = new URL(`${API_BASE_URL}/api/field-assessment`);
  url.searchParams.set("lat", lat.toString());
  url.searchParams.set("lon", lon.toString());
  url.searchParams.set("fertilizer_type", fertilizerType);
  url.searchParams.set("crop_stage", cropStage);
  url.searchParams.set("save_money", saveMoney ? "true" : "false");
  if (sandPercentOverride !== null) url.searchParams.set("sand_percent_override", String(sandPercentOverride));
  if (fieldPolygon && fieldPolygon.length >= 4) url.searchParams.set("field_polygon", JSON.stringify(fieldPolygon));

  const cacheKey = `${STORAGE_PREFIX}${lat.toFixed(2)}:${lon.toFixed(2)}:${fertilizerType}:${cropStage}:${sandPercentOverride ?? "soilgrids"}:${fieldPolygon ? JSON.stringify(fieldPolygon) : "point"}`;

  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(ASSESSMENT_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Backend returned ${response.status} ${response.statusText}`);

    const data: FieldAssessmentResponse = await response.json();
    if (typeof window !== "undefined") {
      try {
        const envelope: CachedAssessment = { cached_at_utc: new Date().toISOString(), data };
        window.localStorage.setItem(cacheKey, JSON.stringify(envelope));
      } catch {
        // Ignore disabled storage and quota errors; live results remain usable.
      }
    }
    return data;
  } catch (error) {
    const cached = readOfflineAssessment(cacheKey);
    if (cached) return cached;

    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new Error("The field assessment request timed out after 45 seconds. The backend did not respond in time. Please retry.");
    }
    if (error instanceof Error && error.message.startsWith("Backend returned ")) {
      throw error;
    }
    throw new Error(
      `Cannot connect to Safe Field backend at ${API_BASE_URL}. ${error instanceof Error ? error.message : "Network request failed."} No offline assessment less than seven days old is available.`
    );
  }
}
