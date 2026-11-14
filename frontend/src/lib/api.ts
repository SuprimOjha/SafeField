import { FieldAssessmentResponse } from "@/types/safefield";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";
const STORAGE_PREFIX = "safefield_cache_v1:";

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
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Backend returned ${response.status} ${response.statusText}`);
    }

    const data: FieldAssessmentResponse = await response.json();

    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(cacheKey, JSON.stringify(data));
      } catch {
        // Ignore storage quota errors
      }
    }

    return data;
  } catch (err) {
    // Fallback to browser localStorage cache if offline or backend unreachable
    if (typeof window !== "undefined") {
      const cached = window.localStorage.getItem(cacheKey);
      if (cached) {
        const parsed: FieldAssessmentResponse = JSON.parse(cached);
        parsed.power_summary.freshness.status = "CACHED_FALLBACK";
        if (parsed.rainfall_observation.provenance) {
          parsed.rainfall_observation.provenance.kind = "fallback";
          parsed.rainfall_observation.provenance.latency_note += " Browser local cache fallback; original observation timestamps are unchanged.";
        }
        return parsed;
      }
    }

    throw new Error(
      `Cannot connect to Safe Field backend at ${API_BASE_URL}. Make sure FastAPI (uvicorn) is running on port 8000.`
    );
  }
}