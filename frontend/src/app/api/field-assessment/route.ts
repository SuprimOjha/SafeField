// Self-contained field assessment endpoint. The deployed frontend previously
// depended on a Python FastAPI backend hosted on a free-tier Render instance,
// which sleeps after inactivity (cold starts exceed the frontend's 45 s
// timeout) and whose shared egress IP is rate-limited by upstream data
// providers. That made the Vercel deployment unusable and left the
// "Local rainfall" and "Terrain & Slope" cards without real data.
//
// This route handler aggregates every upstream source directly with honest,
// labelled provenance and never substitutes guessed values:
//   - NASA POWER daily agroclimatology (temperature, wetness proxies, history)
//   - Real 72-hour rainfall observation (Open-Meteo reanalysis past days)
//   - Terrain & slope (Open-Meteo Elevation API, Copernicus DEM GLO-90)
//   - ISRIC SoilGrids 250 m topsoil texture
//   - Open-Meteo five-day forecast
//   - Deterministic decision rules and heavy-rain trend statistics

import { NextRequest, NextResponse } from "next/server";
import type { FieldAssessmentResponse, DailyWeatherRecord } from "@/types/safefield";
import { getFieldWeatherAndHistory } from "@/lib/server/power";
import { getFieldSlopeAndElevation } from "@/lib/server/elevation";
import { getSoilTexture } from "@/lib/server/soilgrids";
import { get5DayRainForecast } from "@/lib/server/forecast";
import { getRecentRain } from "@/lib/server/rainfall";
import { evaluateTiming } from "@/lib/server/decision";
import { analyzeHeavyRainTrend } from "@/lib/server/trend";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NEPAL_BOUNDS = { minLat: 26.3, maxLat: 30.5, minLon: 80.0, maxLon: 88.3 };

function parseFieldPolygon(raw: string | null): [number, number][] | null {
  if (!raw) return null;
  let coordinates: unknown;
  try {
    coordinates = JSON.parse(raw);
  } catch {
    throw new Response("field_polygon must be a JSON array of [longitude, latitude] pairs.", { status: 422 });
  }
  if (!Array.isArray(coordinates) || coordinates.length < 3 || coordinates.length > 201) {
    throw new Response("field_polygon must contain between 3 and 200 vertices.", { status: 422 });
  }
  const points: [number, number][] = [];
  for (const point of coordinates) {
    if (!Array.isArray(point) || point.length !== 2) {
      throw new Response("Each field_polygon vertex must contain exactly longitude and latitude.", { status: 422 });
    }
    const lonValue = Number(point[0]);
    const latValue = Number(point[1]);
    if (
      !Number.isFinite(lonValue) ||
      !Number.isFinite(latValue) ||
      lonValue < NEPAL_BOUNDS.minLon ||
      lonValue > NEPAL_BOUNDS.maxLon ||
      latValue < NEPAL_BOUNDS.minLat ||
      latValue > NEPAL_BOUNDS.maxLat
    ) {
      throw new Response("Field polygon coordinates must lie inside the Nepal pilot bounding box.", { status: 422 });
    }
    points.push([lonValue, latValue]);
  }
  return points;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const lat = Number(params.get("lat"));
  const lon = Number(params.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < NEPAL_BOUNDS.minLat || lat > NEPAL_BOUNDS.maxLat || lon < NEPAL_BOUNDS.minLon || lon > NEPAL_BOUNDS.maxLon) {
    return NextResponse.json({ detail: "lat must be within 26.3–30.5 and lon within 80.0–88.3 (Nepal pilot area)." }, { status: 422 });
  }
  const fertilizerType = params.get("fertilizer_type") ?? "Urea";
  const cropStage = params.get("crop_stage") ?? "Vegetative / Tillering";
  const saveMoney = params.get("save_money") !== "false";
  const sandParam = params.get("sand_percent_override");
  const sandOverride = sandParam === null || sandParam === "" ? null : Number(sandParam);
  if (sandOverride !== null && (!Number.isFinite(sandOverride) || sandOverride < 0 || sandOverride > 100)) {
    return NextResponse.json({ detail: "sand_percent_override must be between 0 and 100." }, { status: 422 });
  }

  try {
    // Validate any supplied polygon, even though the current assessment is point/grid based.
    parseFieldPolygon(params.get("field_polygon"));
  } catch (errorResponse) {
    if (errorResponse instanceof Response) return errorResponse;
    throw errorResponse;
  }

  try {
    const [powerRes, elevRes, soilRes, forecastRes] = await Promise.all([
      getFieldWeatherAndHistory(lat, lon, 10),
      getFieldSlopeAndElevation(lat, lon),
      getSoilTexture(lat, lon),
      get5DayRainForecast(lat, lon),
    ]);

    // Rainfall: real reanalysis observation for the last 3 complete UTC days.
    const rainfallObservation = await getRecentRain(
      lat,
      lon,
      72,
      powerRes.recent_daily_records as DailyWeatherRecord[],
      powerRes.rain_last_72h_mm,
      powerRes.freshness.spatial_resolution,
    );

    const decisionRes = evaluateTiming({
      rain_last_72h_mm: rainfallObservation.status === "AVAILABLE" ? rainfallObservation.amount_mm : null,
      expected_rain_next_48h_mm: forecastRes.freshness.status !== "UNAVAILABLE" ? forecastRes.expected_rain_next_48h_mm : null,
      soil_wetness: powerRes.latest_surface_wetness,
      sand_percent: sandOverride !== null ? sandOverride : soilRes.freshness.status !== "UNAVAILABLE" ? soilRes.sand_percent : null,
      slope_percent: elevRes.slope_percent,
      fertilizer_type: fertilizerType,
      crop_stage: cropStage,
      priority_save_money: saveMoney,
      rainfall_observation: rainfallObservation,
    });

    // Heavy-rain-days trend over the historical POWER record (>= 15 mm/day).
    const yearlyHeavyDays = new Map<number, number>();
    for (const record of powerRes.historical_daily_records) {
      if (record.precip_mm === null || !record.date) continue;
      const year = Number(record.date.slice(0, 4));
      if (!Number.isFinite(year)) continue;
      // Retain years with valid precipitation but zero heavy-rain days.
      if (!yearlyHeavyDays.has(year)) yearlyHeavyDays.set(year, 0);
      if (record.precip_mm >= 15.0) {
        yearlyHeavyDays.set(year, (yearlyHeavyDays.get(year) as number) + 1);
      }
    }
    const sortedYears = [...yearlyHeavyDays.keys()].sort((a, b) => a - b);
    const counts = sortedYears.map((year) => yearlyHeavyDays.get(year) as number);
    const trendRes = analyzeHeavyRainTrend(sortedYears, counts);

    const payload: FieldAssessmentResponse = {
      latitude: lat,
      longitude: lon,
      power_summary: powerRes,
      elevation: elevRes,
      soil_texture: soilRes,
      forecast: forecastRes,
      decision: decisionRes,
      climate_trend: trendRes,
      rainfall_observation: rainfallObservation,
    };
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Field assessment failed:", error);
    return NextResponse.json(
      { detail: `Field assessment failed: ${String(error)}` },
      { status: 502 },
    );
  }
}
