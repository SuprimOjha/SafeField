// Elevation and slope estimation (TypeScript port of elevation_client.py with
// a more reliable primary provider). The public Open-Elevation endpoint is
// frequently rate-limited (HTTP 429) when called from shared cloud IPs, which
// left "Terrain & Slope" permanently unavailable on deployments. The primary
// source is now the Open-Meteo Elevation API (Copernicus DEM GLO-90), which
// serves up to 100 coordinates per request without a key; Open-Elevation is
// kept as a secondary fallback. Slope is computed from the same 3x3 stencil
// with finite differences. No elevation or slope value is ever invented when
// both providers fail.

import type { FreshnessBadgeData, ElevationResponse } from "@/types/safefield";
import { cacheGet, cacheSet, utcNowIso } from "./cache";
import { fetchJson, sanitizeUpstreamError, withHardDeadline } from "./upstream";

const OPEN_METEO_ELEVATION_URL = "https://api.open-meteo.com/v1/elevation";
const OPEN_ELEVATION_URL = "https://api.open-elevation.com/api/v1/lookup";
const OPEN_TOPO_DATA_URL = "https://api.opentopodata.org/v1/srtm30m";
const ELEVATION_CACHE_TTL_SECONDS = 30 * 86400;

function badge(
  datasetName: string,
  sourceOrg: string,
  isNasa: boolean,
  status: FreshnessBadgeData["status"],
  latestObservation: string | null,
  fetchedAt: string,
  resolution: string,
  caveat: string,
  docsUrl: string,
): FreshnessBadgeData {
  return {
    dataset_name: datasetName,
    source_org: sourceOrg,
    is_nasa: isNasa,
    status,
    latest_observation_date: latestObservation,
    fetched_at_utc: fetchedAt,
    typical_latency: "Static dataset (no recent change)",
    spatial_resolution: resolution,
    caveat,
    docs_url: docsUrl,
  };
}

function terrainCategory(slopePct: number): string {
  if (slopePct < 2.0) return "Flat (Terai)";
  if (slopePct < 8.0) return "Gentle Slope";
  if (slopePct < 20.0) return "Moderate Slope";
  return "Steep Hillside";
}

/**
 * Compute slope (%) from nine elevations sampled on a 3x3 stencil, using the
 * same Horn-style finite differences as the Python implementation.
 * Elevations are ordered row-major: indices 0..2 are the north row
 * (latitude + delta), 3..5 the middle row, 6..8 the south row.
 */
function slopeFromStencil(elevations: number[], deltaDeg: number, latDeg: number): number {
  const dx = 2.0 * deltaDeg * 111320.0 * Math.cos((latDeg * Math.PI) / 180); // metres per 2*delta lon
  const dy = 2.0 * deltaDeg * 111100.0; // metres per 2*delta lat

  const dzDx = (elevations[2] + 2 * elevations[5] + elevations[8] - (elevations[0] + 2 * elevations[3] + elevations[6])) / dx;
  const dzDy = (elevations[6] + 2 * elevations[7] + elevations[8] - (elevations[0] + 2 * elevations[1] + elevations[2])) / dy;

  const slopeFrac = Math.sqrt(dzDx * dzDx + dzDy * dzDy);
  return Math.round(slopeFrac * 100.0 * 10) / 10;
}

async function fetchOpenMeteoElevations(points: { lat: number; lon: number }[]): Promise<number[]> {
  const latitudes = points.map((p) => p.lat.toFixed(6)).join(",");
  const longitudes = points.map((p) => p.lon.toFixed(6)).join(",");
  const raw = await withHardDeadline(fetchJson<{ elevation: number[] }>(OPEN_METEO_ELEVATION_URL, {
    params: { latitude: latitudes, longitude: longitudes },
    timeoutMs: 10_000,
    retries: 0,
  }), 12_000, "Open-Meteo elevation");
  if (!Array.isArray(raw.elevation) || raw.elevation.length !== points.length) {
    throw new Error("Open-Meteo elevation grid incomplete");
  }
  return raw.elevation.map((value) => Number(value));
}

async function fetchOpenElevationElevations(points: { lat: number; lon: number }[]): Promise<number[]> {
  const raw = await withHardDeadline(fetchJson<{ results: { elevation: number }[] }>(OPEN_ELEVATION_URL, {
    method: "POST",
    body: { locations: points.map((p) => ({ latitude: p.lat, longitude: p.lon })) },
    timeoutMs: 10_000,
    retries: 0,
  }), 10_000, "Open-Elevation");
  const results = raw.results ?? [];
  if (results.length !== points.length) throw new Error("Incomplete elevation grid returned");
  return results.map((r) => Number(r.elevation));
}

async function fetchOpenTopoDataElevations(points: { lat: number; lon: number }[]): Promise<number[]> {
  // OpenTopoData SRTM 30 m dataset; pipe-separated coordinate list, one request.
  const locations = points.map((p) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`).join("|");
  const raw = await withHardDeadline(fetchJson<{ results: { elevation: number | null }[] }>(`${OPEN_TOPO_DATA_URL}?locations=${encodeURIComponent(locations)}`, {
    timeoutMs: 10_000,
    retries: 0,
  }), 10_000, "OpenTopoData");
  const results = raw.results ?? [];
  if (results.length !== points.length) throw new Error("Incomplete OpenTopoData elevation grid returned");
  const values = results.map((r) => Number(r.elevation));
  if (values.some((value) => !Number.isFinite(value))) throw new Error("OpenTopoData returned null elevations");
  return values;
}

export async function getFieldSlopeAndElevation(
  latitude: number,
  longitude: number,
): Promise<ElevationResponse> {
  const latR = Math.round(latitude * 10000) / 10000;
  const lonR = Math.round(longitude * 10000) / 10000;
  const cacheKey = `elevation_slope:${latR}:${lonR}`;

  const hit = cacheGet<{ response: ElevationResponse }>(cacheKey);
  if (hit) return hit.response;

  // Sample 3x3 grid with ~0.0008 deg offset (~90m spacing) for slope calculation
  const delta = 0.0008;
  const points = [
    { lat: latR + delta, lon: lonR - delta }, { lat: latR + delta, lon: lonR }, { lat: latR + delta, lon: lonR + delta },
    { lat: latR, lon: lonR - delta }, { lat: latR, lon: lonR }, { lat: latR, lon: lonR + delta },
    { lat: latR - delta, lon: lonR - delta }, { lat: latR - delta, lon: lonR }, { lat: latR - delta, lon: lonR + delta },
  ];

  const providers: {
    name: string;
    label: string;
    docsUrl: string;
    fetch: () => Promise<number[]>;
  }[] = [
    {
      name: "Open-Meteo Elevation API",
      label: "Copernicus DEM GLO-90 (via Open-Meteo Elevation API)",
      docsUrl: "https://open-meteo.com/en/docs/elevation-api",
      fetch: () => fetchOpenMeteoElevations(points),
    },
    {
      name: "Open-Elevation API",
      label: "Open-Elevation API (SRTM/NASADEM lineage not verified)",
      docsUrl: "https://open-elevation.com/",
      fetch: () => fetchOpenElevationElevations(points),
    },
    {
      name: "OpenTopoData",
      label: "SRTM 30 m (via OpenTopoData)",
      docsUrl: "https://www.opentopodata.org/",
      fetch: () => fetchOpenTopoDataElevations(points),
    },
  ];

  let lastError: unknown = null;
  for (const provider of providers) {
    try {
      const elevations = provider.fetch();
      const resolved = await elevations;
      if (resolved.some((value) => !Number.isFinite(value))) {
        throw new Error("Elevation grid contained non-finite values");
      }
      const centerElev = resolved[4];
      const slopePct = slopeFromStencil(resolved, delta, latR);
      const category = terrainCategory(slopePct);
      const fetchedAt = utcNowIso();
      const response: ElevationResponse = {
        latitude: latR,
        longitude: lonR,
        elevation_meters: Math.round(centerElev * 10) / 10,
        slope_percent: slopePct,
        terrain_category: category,
        freshness: badge(
          provider.label,
          provider.name,
          false,
          "LIVE",
          "Static Terrain Model (Copernicus DEM GLO-90, 2019–2021 release)",
          fetchedAt,
          "90 m grid cells sampled on a 3x3 stencil",
          "Elevation values are returned by " + provider.name + " (Copernicus DEM GLO-90). Slope is estimated from a local 3x3 stencil; it is a terrain model estimate, not a surveyed field measurement.",
          provider.docsUrl,
        ),
      };
      cacheSet(cacheKey, { response }, ELEVATION_CACHE_TTL_SECONDS);
      return response;
    } catch (error) {
      lastError = error;
    }
  }

  const stale = cacheGet<{ response: ElevationResponse }>(cacheKey);
  if (stale) {
    const parsed: ElevationResponse = {
      ...stale.response,
      freshness: {
        ...stale.response.freshness,
        status: "CACHED_FALLBACK",
        fetched_at_utc: utcNowIso(),
        caveat: `Showing the previously cached elevation estimate because the upstream request did not complete (${sanitizeUpstreamError(lastError)}). ${stale.response.freshness.caveat}`,
      },
    };
    return parsed;
  }

  // Do not substitute guessed elevation or slope when no verified result exists.
  return {
    latitude: latR,
    longitude: lonR,
    elevation_meters: null,
    slope_percent: null,
    terrain_category: "Unavailable",
    freshness: badge(
      "Copernicus DEM GLO-90 Global Elevation Model",
      "Open-Meteo Elevation API / Open-Elevation service",
      false,
      "UNAVAILABLE",
      null,
      utcNowIso(),
      "Unknown",
      `Elevation service is temporarily unavailable, so no terrain value is shown (${sanitizeUpstreamError(lastError)}). No default elevation or slope is substituted.`,
      "https://open-meteo.com/en/docs/elevation-api",
    ),
  };
}
