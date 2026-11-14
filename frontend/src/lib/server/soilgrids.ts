// ISRIC SoilGrids 250 m topsoil texture client (port of soilgrids_client.py).
// Missing means stay missing; they are never replaced by a plausible-looking
// default.

import type { FreshnessBadgeData, SoilTextureResponse } from "@/types/safefield";
import { cacheGet, cacheSet, utcNowIso } from "./cache";
import { fetchJson } from "./upstream";

const SOILGRIDS_URL = "https://rest.isric.org/soilgrids/v2.0/properties/query";
const SOILGRIDS_DOCS = "https://rest.isric.org/soilgrids/v2.0/docs";
const SOILGRIDS_CACHE_TTL = 30 * 86400;

interface SoilGridsLayer {
  name?: string;
  depths?: { values?: { mean?: number | null } }[];
}

function extractLayerMeanPercent(layer: SoilGridsLayer): number | null {
  const depths = layer.depths ?? [];
  if (!depths.length) return null;
  const rawValue = depths[0]?.values?.mean;
  if (rawValue === null || rawValue === undefined) return null;
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value < 0 || value > 1000) return null;
  return Math.round(value / 10.0 * 10) / 10;
}

function badge(status: FreshnessBadgeData["status"], fetchedAt: string, caveat: string): FreshnessBadgeData {
  return {
    dataset_name: "ISRIC SoilGrids 250m Topsoil Properties (0-5cm)",
    source_org: "ISRIC World Soil Information (CC BY 4.0)",
    is_nasa: false,
    status,
    latest_observation_date: status === "UNAVAILABLE" ? null : "Global Digital Soil Mapping (2020)",
    fetched_at_utc: fetchedAt,
    typical_latency: "Static global model",
    spatial_resolution: "250 meter",
    caveat,
    docs_url: SOILGRIDS_DOCS,
  };
}

export async function getSoilTexture(latitude: number, longitude: number): Promise<SoilTextureResponse> {
  const latR = Math.round(latitude * 10000) / 10000;
  const lonR = Math.round(longitude * 10000) / 10000;
  const cacheKey = `soilgrids_texture:${latR}:${lonR}`;

  const hit = cacheGet<{ response: SoilTextureResponse }>(cacheKey);
  if (hit) return hit.response;

  try {
    const raw = await fetchJson<{ properties?: { layers?: SoilGridsLayer[] } }>(SOILGRIDS_URL, {
      params: {
        lat: latR,
        lon: lonR,
        property: ["clay", "silt", "sand"],
        depth: "0-5cm",
        value: "mean",
      },
      timeoutMs: 25_000,
      retries: 1,
    });
    const layers = raw.properties?.layers ?? [];
    const props: Record<string, number | null> = {};
    for (const layer of layers) {
      if (layer.name === "clay" || layer.name === "silt" || layer.name === "sand") {
        props[layer.name] = extractLayerMeanPercent(layer);
      }
    }

    const clay = props["clay"];
    const silt = props["silt"];
    const sand = props["sand"];
    if (clay === null || silt === null || sand === null || clay === undefined || silt === undefined || sand === undefined) {
      throw new Error("SoilGrids omitted one or more valid texture means");
    }

    const textureClass = sand > 55.0 ? "Sandy" : clay > 35.0 ? "Clayey" : "Loamy";

    const fetchedAt = utcNowIso();
    const response: SoilTextureResponse = {
      latitude: latR,
      longitude: lonR,
      clay_percent: clay,
      silt_percent: silt,
      sand_percent: sand,
      texture_class: textureClass,
      freshness: badge(
        "LIVE",
        fetchedAt,
        "Non-NASA SoilGrids predicted topsoil properties at 250 m. These are model estimates, not a field soil test.",
      ),
    };
    cacheSet(cacheKey, { response }, SOILGRIDS_CACHE_TTL);
    return response;
  } catch (error) {
    const stale = cacheGet<{ response: SoilTextureResponse }>(cacheKey);
    if (stale) {
      return {
        ...stale.response,
        freshness: badge(
          "CACHED_FALLBACK",
          utcNowIso(),
          `Showing previously cached SoilGrids estimate because the upstream request failed: ${String(error)}. ${stale.response.freshness.caveat}`,
        ),
      };
    }
    return {
      latitude: latR,
      longitude: lonR,
      clay_percent: null,
      silt_percent: null,
      sand_percent: null,
      texture_class: "Unavailable",
      freshness: badge(
        "UNAVAILABLE",
        utcNowIso(),
        `SoilGrids request failed or returned incomplete data: ${String(error)}. No regional or default value is substituted. Confirm locally.`,
      ),
    };
  }
}
