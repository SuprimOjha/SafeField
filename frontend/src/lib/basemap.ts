import { Map as MapLibreMap } from "maplibre-gl";

export const STREET_STYLE =
  "https://tiles.openfreemap.org/styles/bright";

const SATELLITE_SOURCE = "esri-satellite";
const SATELLITE_LAYER = "esri-satellite-layer";
const SATELLITE_TILES =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

// Esri's published World Imagery attribution. Keep it visible whenever imagery is shown.
export const ESRI_ATTRIBUTION =
  "Sources: Esri, Maxar, Earthstar Geographics, and the GIS User Community.";

export function createMap(container: HTMLElement, center: [number, number], zoom = 7): MapLibreMap {
  return new MapLibreMap({
    container,
    style: STREET_STYLE,
    center,
    zoom,
    minZoom: 5,
    maxZoom: 18,
    maxBounds: [[79.8, 26.2], [88.5, 30.6]],
    attributionControl: { compact: true },
  });
}

/** Add imagery once, below the OpenFreeMap label layers, and leave it hidden by default. */
export function addSatelliteLayer(map: MapLibreMap): void {
  if (map.getSource(SATELLITE_SOURCE)) return;

  map.addSource(SATELLITE_SOURCE, {
    type: "raster",
    tiles: [SATELLITE_TILES],
    tileSize: 256,
    // Conservative display cap. Confirm imagery quality at each pilot location before raising.
    maxzoom: 18,
    attribution: ESRI_ATTRIBUTION,
  });

  const firstSymbolLayer = map.getStyle().layers?.find((layer) => layer.type === "symbol")?.id;
  map.addLayer(
    {
      id: SATELLITE_LAYER,
      type: "raster",
      source: SATELLITE_SOURCE,
      layout: { visibility: "none" },
    },
    firstSymbolLayer,
  );
}

export function setSatellite(map: MapLibreMap, enabled: boolean): void {
  if (!map.getLayer(SATELLITE_LAYER)) return;
  map.setLayoutProperty(SATELLITE_LAYER, "visibility", enabled ? "visible" : "none");
}

export function isSatelliteSourceError(event: unknown): boolean {
  if (!event || typeof event !== "object") return false;
  const candidate = event as { sourceId?: unknown; error?: { sourceId?: unknown } };
  return candidate.sourceId === SATELLITE_SOURCE || candidate.error?.sourceId === SATELLITE_SOURCE;
}
