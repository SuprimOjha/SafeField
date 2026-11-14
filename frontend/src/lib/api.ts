import { FieldAssessmentResponse } from "@/types/safefield";

// Default to the app's own Next.js API route (same-origin), which works on
// Vercel and in local development without a separately hosted backend.
// Set NEXT_PUBLIC_API_BASE_URL (for example "http://127.0.0.1:8000") to use
// the optional Python FastAPI backend instead.
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";
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
  // When API_BASE_URL is empty (same-origin Next.js route), parse the
  // relative path against a dummy base and keep only the path + query.
  const parsed = new URL(`${API_BASE_URL}/api/field-assessment`, API_BASE_URL ? undefined : "http://safefield.local");
  parsed.searchParams.set("lat", lat.toString());
  parsed.searchParams.set("lon", lon.toString());
  parsed.searchParams.set("fertilizer_type", fertilizerType);
  parsed.searchParams.set("crop_stage", cropStage);
  parsed.searchParams.set("save_money", saveMoney ? "true" : "false");
  if (sandPercentOverride !== null) parsed.searchParams.set("sand_percent_override", String(sandPercentOverride));
  if (fieldPolygon && fieldPolygon.length >= 4) parsed.searchParams.set("field_polygon", JSON.stringify(fieldPolygon));
  const requestUrl = API_BASE_URL ? parsed.toString() : parsed.pathname + parsed.search;

  const cacheKey = `${STORAGE_PREFIX}${lat.toFixed(5)}:${lon.toFixed(5)}:${fertilizerType}:${cropStage}:${sandPercentOverride ?? "soilgrids"}:${fieldPolygon ? JSON.stringify(fieldPolygon) : "point"}`;

  try {
    const response = await fetch(requestUrl, {
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
      `Cannot reach the Safe Field assessment service. ${error instanceof Error ? error.message : "Network request failed."} No offline assessment less than seven days old is available.`
    );
  }
}
