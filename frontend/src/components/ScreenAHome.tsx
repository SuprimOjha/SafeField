"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Map as MapLibreMap,
  setWorkerUrl,
  Marker as MapLibreMarker,
  NavigationControl,
  ScaleControl,
  LngLatBounds,
  type MapMouseEvent,
  type GeoJSONSource,
} from "maplibre-gl";
import type { Feature, FeatureCollection, Geometry, Polygon, MultiPolygon } from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";
import { createMap, addSatelliteLayer, setSatellite, isSatelliteSourceError } from "@/lib/basemap";
import {
  MapPin, Navigation, Compass, ArrowRight, Pencil, Undo2, Trash2,
  Check, Layers3, LocateFixed, MousePointer2,
} from "lucide-react";

interface ScreenAHomeProps {
  selectedLat: number;
  selectedLon: number;
  onLocationSelect: (lat: number, lon: number, name: string) => void;
  onFieldPolygonSelect: (polygon: [number, number][] | null) => void;
  onProceedToField: () => void;
  lang: "en" | "ne";
}

type DrawMode = "select" | "draw";
type DistrictProperties = { DISTRICT?: string; PROVINCE?: number; HQ?: string };
type DistrictFeature = Feature<Polygon | MultiPolygon, DistrictProperties>;

const EMPTY_FEATURES: FeatureCollection<Polygon> = { type: "FeatureCollection", features: [] };
function getCoordinates(geometry: DistrictFeature["geometry"]): number[][] {
  const points: number[][] = [];
  const visit = (value: unknown) => {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === "number" && typeof value[1] === "number") {
      points.push(value as number[]);
      return;
    }
    value.forEach(visit);
  };
  visit(geometry.coordinates);
  return points;
}

function polygonAreaHectares(points: [number, number][]) {
  if (points.length < 3) return 0;
  const radius = 6378137;
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const [lon1, lat1] = points[i];
    const [lon2, lat2] = points[(i + 1) % points.length];
    area += (lon2 - lon1) * Math.PI / 180 *
      (2 + Math.sin(lat1 * Math.PI / 180) + Math.sin(lat2 * Math.PI / 180));
  }
  return Math.abs(area * radius * radius / 2) / 10000;
}

export default function ScreenAHome({
  selectedLat,
  selectedLon,
  onLocationSelect,
  onFieldPolygonSelect,
  onProceedToField,
  lang,
}: ScreenAHomeProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<MapLibreMarker | null>(null);
  const onLocationSelectRef = useRef(onLocationSelect);
  const drawPointsRef = useRef<[number, number][]>([]);
  const districtsRef = useRef<DistrictFeature[]>([]);
  const drawModeRef = useRef<DrawMode>("select");
  const [locationName, setLocationName] = useState("Biratnagar, Morang");
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapStyle, setMapStyle] = useState<"streets" | "satellite">("streets");
  const mapStyleRef = useRef(mapStyle);
  const selectedCoordinatesRef = useRef({ lat: selectedLat, lon: selectedLon });
  const [drawMode, setDrawMode] = useState<DrawMode>("select");
  const [drawPoints, setDrawPoints] = useState<[number, number][]>([]);
  const [fieldArea, setFieldArea] = useState<number | null>(null);
  const [districts, setDistricts] = useState<DistrictFeature[]>([]);
  const [districtName, setDistrictName] = useState("");
  const [districtLoading, setDistrictLoading] = useState(true);
  const [mapReady, setMapReady] = useState(false);
  const [satelliteAvailable, setSatelliteAvailable] = useState(true);

  const copy = {
    title: lang === "ne" ? "आफ्नो खेतको स्थान छान्नुहोस्" : "Choose your farm location",
    subtitle: lang === "ne" ? "जिल्ला छान्नुहोस्, GPS प्रयोग गर्नुहोस् वा नक्सामा एक पटक थिचेर पिन राख्नुहोस्। सीमा कोर्नु वैकल्पिक हो।" : "Choose a district, use GPS or tap once to place a pin. Drawing a boundary is optional.",
    streets: lang === "ne" ? "सडक नक्सा" : "Street map",
    satellite: lang === "ne" ? "स्याटेलाइट" : "Satellite",
    district: lang === "ne" ? "जिल्ला छान्नुहोस्" : "Select district",
    tap: lang === "ne" ? "नक्सामा पिन राख्नुहोस्" : "Tap to drop a pin",
    draw: lang === "ne" ? "आफ्नो खेत कोर्नुहोस्" : "Draw my land",
    finish: lang === "ne" ? "सीमा पूरा भयो" : "Finish boundary",
    undo: lang === "ne" ? "पछिल्लो बिन्दु हटाउनुहोस्" : "Undo point",
    clear: lang === "ne" ? "मेटाउनुहोस्" : "Clear",
    points: lang === "ne" ? "बिन्दु" : "Points",
    area: lang === "ne" ? "अनुमानित क्षेत्रफल" : "Estimated area",
    instruction: lang === "ne" ? "खेतको कुनाकाप्चामा ट्याप गरेर सीमा कोर्नुहोस्। कम्तीमा ३ बिन्दु चाहिन्छ।" : "Optional: tap at least 3 field corners to estimate the boundary and area.",
    gps: lang === "ne" ? "मेरो GPS स्थान" : "Use my GPS",
  };

  useEffect(() => { onLocationSelectRef.current = onLocationSelect; }, [onLocationSelect]);
  useEffect(() => { drawPointsRef.current = drawPoints; }, [drawPoints]);
  useEffect(() => { districtsRef.current = districts; }, [districts]);
  useEffect(() => { drawModeRef.current = drawMode; }, [drawMode]);
  useEffect(() => { mapStyleRef.current = mapStyle; }, [mapStyle]);
  useEffect(() => {
    selectedCoordinatesRef.current = { lat: selectedLat, lon: selectedLon };
  }, [selectedLat, selectedLon]);

  useEffect(() => {
    let cancelled = false;
    fetch("/data/nepal-districts.geojson")
      .then((response) => {
        if (!response.ok) throw new Error("District boundary file is not available.");
        return response.json();
      })
      .then((data: FeatureCollection) => {
        if (!cancelled) setDistricts(data.features as DistrictFeature[]);
      })
      .catch((error) => {
        console.error("Could not load Nepal district boundaries:", error);
        if (!cancelled) setMapError("Nepal district boundaries could not be loaded. Refresh the page or check the deployment build.");
      })
      .finally(() => { if (!cancelled) setDistrictLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const updateDrawLayer = useCallback((map: MapLibreMap, points: [number, number][]) => {
    const features: Feature<Geometry>[] = points.map((coordinates, index) => ({
      type: "Feature",
      properties: { pointIndex: index + 1 },
      geometry: { type: "Point", coordinates },
    }));

    if (points.length >= 2) {
      features.push({
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: points },
      });
    }

    if (points.length >= 3) {
      features.push({
        type: "Feature",
        properties: {},
        geometry: { type: "Polygon", coordinates: [[...points, points[0]]] },
      });
    }

    const source = map.getSource("user-field") as GeoJSONSource | undefined;
    source?.setData({ type: "FeatureCollection", features });
  }, []);

  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container) return;

    setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
    const initialLocation = selectedCoordinatesRef.current;
    const map = createMap(container, [initialLocation.lon, initialLocation.lat]);
    mapRef.current = map;
    map.addControl(new NavigationControl({ visualizePitch: true }), "top-right");
    map.addControl(new ScaleControl({ unit: "metric" }), "bottom-right");

    const marker = new MapLibreMarker({ color: "#047857", draggable: false })
      .setLngLat([initialLocation.lon, initialLocation.lat]).addTo(map);
    markerRef.current = marker;

    const installLayers = () => {
      addSatelliteLayer(map);
      setSatellite(map, mapStyleRef.current === "satellite");
      if (!map.getSource("nepal-districts") && districtsRef.current.length) {
        map.addSource("nepal-districts", {
          type: "geojson",
          data: { type: "FeatureCollection", features: districtsRef.current },
        });
        map.addLayer({
          id: "district-fill", type: "fill", source: "nepal-districts",
          paint: { "fill-color": "#16a34a", "fill-opacity": 0.035 },
        });
        map.addLayer({
          id: "district-lines", type: "line", source: "nepal-districts",
          paint: { "line-color": "#087443", "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.7, 11, 1.6], "line-opacity": 0.85 },
        });
      }
      if (!map.getSource("user-field")) {
        map.addSource("user-field", { type: "geojson", data: EMPTY_FEATURES });
        map.addLayer({
          id: "user-field-fill", type: "fill", source: "user-field",
          paint: { "fill-color": "#10b981", "fill-opacity": 0.3 },
        });
        map.addLayer({
          id: "user-field-outline", type: "line", source: "user-field",
          paint: { "line-color": "#047857", "line-width": 3, "line-dasharray": [2, 1] },
        });
        map.addLayer({
          id: "user-field-points", type: "circle", source: "user-field",
          filter: ["==", ["geometry-type"], "Point"],
          paint: {
            "circle-radius": 6,
            "circle-color": "#ffffff",
            "circle-stroke-color": "#047857",
            "circle-stroke-width": 3,
          },
        });
      }
    };

    map.on("load", () => {
      setMapReady(true);
      setMapError(null);
      installLayers();
    });

    map.on("style.load", installLayers);
    map.on("click", (event: MapMouseEvent) => {
      const { lng, lat } = event.lngLat;
      if (drawModeRef.current === "draw") {
        const next = [...drawPointsRef.current, [lng, lat] as [number, number]];
        drawPointsRef.current = next;
        setDrawPoints(next);
        updateDrawLayer(map, next);
        return;
      }
      // A normal map tap always drops a pin; district selection is handled by the picker.
      onLocationSelectRef.current(lat, lng, `Selected field (${lat.toFixed(4)}, ${lng.toFixed(4)})`);
      onFieldPolygonSelect(null);
      setDistrictName("");
      setLocationName(`Selected field · ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
      marker.setLngLat([lng, lat]);
    });

    map.on("error", (event) => {
      console.error("MapLibre map error:", event.error);
      if (isSatelliteSourceError(event)) {
        setSatelliteAvailable(false);
        setMapStyle("streets");
        setMapError("Satellite imagery is unavailable here. The OpenFreeMap street map remains selected.");
        return;
      }
      setMapReady(true);
      setMapError("Map tiles could not be loaded. Use the district picker or GPS while the map reconnects.");
    });

    return () => {
      marker.remove();
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      setMapReady(false);
    };
  // Keep one OpenFreeMap vector map; satellite imagery is toggled as a raster overlay.
  }, [updateDrawLayer]);

  useEffect(() => {
    const map = mapRef.current;
    if (map?.getLayer("esri-satellite-layer")) {
      setSatellite(map, mapStyle === "satellite");
    }
  }, [mapStyle, mapReady]);

  useEffect(() => {
    if (markerRef.current && mapRef.current && drawMode === "select") {
      markerRef.current.setLngLat([selectedLon, selectedLat]);
    }
  }, [selectedLat, selectedLon, drawMode]);

  useEffect(() => {
    if (mapRef.current) updateDrawLayer(mapRef.current, drawPoints);
  }, [drawPoints, updateDrawLayer]);

  const selectDistrict = (name: string) => {
    const feature = districts.find((item) => item.properties?.DISTRICT === name);
    if (!feature) return;
    const coords = getCoordinates(feature.geometry);
    if (!coords.length) return;
    const bounds = coords.reduce((value, point) => ({
      minLon: Math.min(value.minLon, point[0]),
      minLat: Math.min(value.minLat, point[1]),
      maxLon: Math.max(value.maxLon, point[0]),
      maxLat: Math.max(value.maxLat, point[1]),
    }), { minLon: Infinity, minLat: Infinity, maxLon: -Infinity, maxLat: -Infinity });
    const lon = (bounds.minLon + bounds.maxLon) / 2;
    const lat = (bounds.minLat + bounds.maxLat) / 2;
    setDistrictName(name);
    setLocationName(`${name} District · approximate centre`);
    onLocationSelect(lat, lon, `${name} District`);
    onFieldPolygonSelect(null);
    markerRef.current?.setLngLat([lon, lat]);
    mapRef.current?.fitBounds([[bounds.minLon, bounds.minLat], [bounds.maxLon, bounds.maxLat]], { padding: 55, maxZoom: 9, essential: true });
  };

  const beginDrawing = () => {
    drawModeRef.current = "draw";
    drawPointsRef.current = [];
    setDrawMode("draw");
    setDrawPoints([]);
    setFieldArea(null);
    onFieldPolygonSelect(null);
    setDistrictName("");
    if (mapRef.current) mapRef.current.getCanvas().style.cursor = "crosshair";
  };

  const undoPoint = () => {
    const next = drawPointsRef.current.slice(0, -1);
    drawPointsRef.current = next;
    setDrawPoints(next);
  };
  const clearDrawing = () => {
    drawPointsRef.current = [];
    setDrawPoints([]);
    setFieldArea(null);
    onFieldPolygonSelect(null);
    if (mapRef.current) updateDrawLayer(mapRef.current, []);
  };

  const finishDrawing = () => {
    if (drawPoints.length < 3) return;
    const area = polygonAreaHectares(drawPoints);
    setFieldArea(area);
    drawModeRef.current = "select";
    setDrawMode("select");
    if (mapRef.current) mapRef.current.getCanvas().style.cursor = "";
    const center = drawPoints.reduce((acc, point) => [acc[0] + point[0], acc[1] + point[1]], [0, 0]);
    const lon = center[0] / drawPoints.length;
    const lat = center[1] / drawPoints.length;
    setLocationName("My drawn field");
    onLocationSelect(lat, lon, "My drawn field");
    onFieldPolygonSelect([...drawPoints, drawPoints[0]]);
    markerRef.current?.setLngLat([lon, lat]);
    mapRef.current?.fitBounds(drawPoints.reduce((bounds, point) => bounds.extend(point), new LngLatBounds(drawPoints[0], drawPoints[0])), { padding: 60, maxZoom: 16 });
  };

  const handleUseGps = () => {
    if (!navigator.geolocation) {
      setMapError("Geolocation is not supported by this browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;
        if (lat < 26.2 || lat > 30.6 || lon < 79.8 || lon > 88.5) {
          setMapError("Your GPS location appears to be outside Nepal.");
          return;
        }
        setDistrictName("");
        onLocationSelect(lat, lon, "My GPS field");
        onFieldPolygonSelect(null);
        setLocationName("My GPS field");
        markerRef.current?.setLngLat([lon, lat]);
        mapRef.current?.flyTo({ center: [lon, lat], zoom: 14 });
      },
      () => setMapError("Unable to retrieve GPS. Allow location access and use HTTPS or localhost.")
    );
  };

  return (
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-3xl border border-emerald-100 bg-gradient-to-br from-[#eaf7ee] via-white to-[#f1f8f1] px-5 py-8 shadow-[0_16px_55px_rgba(15,65,40,0.07)] sm:px-8 sm:py-10">
        <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-emerald-100/60 blur-3xl" />
        <div className="relative max-w-3xl">
          <p className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white/80 px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-[0.16em] text-emerald-800">
            <MapPin className="h-3.5 w-3.5" /> NASA-powered agricultural intelligence
          </p>
          <h1 className="mt-4 max-w-2xl text-3xl font-black leading-tight tracking-tight text-[#123c2b] sm:text-4xl lg:text-5xl">
            Understand your land. Make more informed farming decisions.
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-600 sm:text-base">
            Safe Field Nepal brings together satellite observations, weather and environmental datasets with the details you provide about your field. Select a district, use GPS or tap the map for a first location-based result. Drawing a field boundary is optional and can refine the location and estimate area.
          </p>
          <p className="mt-5 inline-flex items-center gap-2 text-xs font-extrabold uppercase tracking-[0.13em] text-emerald-800 sm:text-sm">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-800 text-white"><ArrowRight className="h-4 w-4 rotate-90" /></span>
            Scroll down to start your analysis
          </p>
        </div>
      </section>

      <section className="overflow-hidden rounded-3xl border border-emerald-100 bg-white shadow-[0_16px_55px_rgba(15,65,40,0.08)]">
        <div className="border-b border-emerald-50 bg-gradient-to-r from-[#f2faf5] via-white to-[#f8fbf6] px-5 py-6 sm:px-7">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="max-w-2xl">
              <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-white px-3 py-1 text-[10px] font-bold uppercase tracking-[.15em] text-emerald-800">
                <LocateFixed className="h-3.5 w-3.5" /> Nepal field mapping
              </div>
              <h2 className="text-2xl font-extrabold tracking-tight text-[#123c2b] sm:text-3xl">{copy.title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">{copy.subtitle} You can start with one tap; drawing is optional.</p>
            </div>
          </div>
        </div>

        <div className="grid gap-3 border-b border-slate-100 bg-white p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end sm:p-5">
          <label className="block">
            <span className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">{copy.district}</span>
            <select value={districtName} onChange={(event) => selectDistrict(event.target.value)} disabled={districtLoading || districts.length === 0}
              className="h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 sm:max-w-md">
              <option value="">{districtLoading ? "Loading Nepal districts…" : "Choose a district (77 districts)"}</option>
              {[...districts].sort((a,b) => (a.properties?.DISTRICT ?? "").localeCompare(b.properties?.DISTRICT ?? "")).map((item) => (
                <option key={item.properties?.DISTRICT} value={item.properties?.DISTRICT}>{item.properties?.DISTRICT}</option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <button onClick={handleUseGps} className="inline-flex h-11 items-center gap-2 rounded-xl bg-emerald-800 px-4 text-sm font-bold text-white transition hover:bg-emerald-900">
              <Navigation className="h-4 w-4" /> {copy.gps}
            </button>
            <button onClick={() => { drawModeRef.current = "select"; setDrawMode("select"); if (mapRef.current) mapRef.current.getCanvas().style.cursor = ""; }} className={`inline-flex h-11 items-center gap-2 rounded-xl border px-4 text-sm font-bold transition ${drawMode === "select" ? "border-emerald-700 bg-emerald-50 text-emerald-900" : "border-slate-200 bg-white text-slate-600"}`}>
              <MousePointer2 className="h-4 w-4" /> {copy.tap}
            </button>
            <button onClick={beginDrawing} className={`inline-flex h-11 items-center gap-2 rounded-xl px-4 text-sm font-bold shadow-sm transition ${drawMode === "draw" ? "bg-emerald-950 text-white" : "bg-emerald-700 text-white hover:bg-emerald-800"}`}>
              <Pencil className="h-4 w-4" /> {copy.draw}
            </button>
          </div>
        </div>

        {drawMode === "draw" && (
          <div className="flex flex-col gap-3 border-b border-emerald-100 bg-emerald-50/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div className="flex items-start gap-2 text-xs leading-5 text-emerald-950">
              <Pencil className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{copy.instruction} <strong>{drawPoints.length} {copy.points}</strong></span>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={undoPoint} disabled={!drawPoints.length} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-3 text-xs font-bold text-emerald-900 disabled:opacity-40"><Undo2 className="h-3.5 w-3.5" />{copy.undo}</button>
              <button onClick={clearDrawing} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 text-xs font-bold text-rose-700"><Trash2 className="h-3.5 w-3.5" />{copy.clear}</button>
              <button onClick={finishDrawing} disabled={drawPoints.length < 3} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-800 px-3 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"><Check className="h-3.5 w-3.5" />{copy.finish}</button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 bg-white px-4 py-3 sm:px-5">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-600"><Layers3 className="h-4 w-4 text-emerald-700" /> Map layers</div>
          <div className="inline-flex rounded-xl border border-slate-200 bg-slate-100 p-1">
            <button type="button" onClick={() => setMapStyle("streets")} aria-pressed={mapStyle === "streets"} className={`rounded-lg px-4 py-2 text-xs font-bold transition ${mapStyle === "streets" ? "bg-white text-emerald-900 shadow-sm" : "text-slate-500 hover:text-slate-900"}`}>{copy.streets}</button>
            <button type="button" onClick={() => { if (satelliteAvailable) setMapStyle("satellite"); }} disabled={!satelliteAvailable} aria-pressed={mapStyle === "satellite"} title={!satelliteAvailable ? "Satellite imagery unavailable; street map remains active" : "Show Esri World Imagery"} className={`rounded-lg px-4 py-2 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${mapStyle === "satellite" ? "bg-white text-emerald-900 shadow-sm" : "text-slate-500 hover:text-slate-900"}`}>{copy.satellite}</button>
          </div>
        </div>

        <div className="relative mx-3 mb-3 h-[440px] overflow-hidden rounded-2xl border border-slate-200 bg-[#eaf1e9] shadow-inner sm:mx-5 sm:h-[560px]">
          <div ref={mapContainerRef} className="h-full w-full" />
          {!mapReady && <div className="absolute inset-0 z-[2] flex items-center justify-center bg-[#edf4ec]/80 text-sm font-semibold text-emerald-900 backdrop-blur-[2px]">Loading Nepal map…</div>}
          {mapError && <div role="alert" className="absolute left-3 right-3 top-3 z-10 rounded-xl border border-amber-300 bg-amber-50/95 px-4 py-3 text-xs font-medium leading-5 text-amber-950 shadow-lg">{mapError}</div>}
          {drawMode === "draw" && <div className="pointer-events-none absolute left-1/2 top-3 z-[5] -translate-x-1/2 rounded-full bg-emerald-950/90 px-4 py-2 text-xs font-bold text-white shadow-lg">Drawing mode · tap field corners</div>}
          <div className="absolute bottom-3 left-3 z-[5] flex max-w-[calc(100%-24px)] items-center gap-2 rounded-xl border border-white/70 bg-white/95 px-3 py-2.5 text-xs text-slate-700 shadow-lg backdrop-blur">
            <Compass className="h-4 w-4 shrink-0 text-emerald-700" />
            <span className="truncate">Selected location: <strong className="text-emerald-900">{locationName}</strong> · {selectedLat.toFixed(4)}°N, {selectedLon.toFixed(4)}°E</span>
          </div>
          <div className="absolute bottom-3 right-3 z-[5] max-w-[85%] rounded-lg bg-white/95 px-3 py-2 text-[10px] font-semibold text-slate-700 shadow">
            {mapStyle === "satellite" ? "Sources: Esri, Maxar, Earthstar Geographics, and the GIS User Community." : "OpenFreeMap · © OpenMapTiles · © OpenStreetMap contributors"}
          </div>
        </div>

        <div className="flex flex-col gap-3 px-4 pb-5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-600">
            <span className="inline-flex items-center gap-2"><span className="h-2.5 w-5 rounded-sm border border-emerald-700 bg-emerald-200/70" /> District boundaries</span>
            {fieldArea !== null && <span className="font-bold text-emerald-900">{copy.area}: {fieldArea.toFixed(3)} ha</span>}
            <span>{districts.length || 0} districts {districtLoading ? "loading…" : "available"}</span>
          </div>
          <button onClick={onProceedToField} className="inline-flex min-h-12 items-center justify-center gap-3 rounded-xl bg-emerald-800 px-7 py-3.5 text-sm font-extrabold text-white shadow-lg shadow-emerald-900/15 transition hover:-translate-y-0.5 hover:bg-emerald-900">
            {lang === "ne" ? "माटो र बाली विवरण भर्नुहोस्" : "Next: Enter Soil & Crop Details"} <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </section>
      <p className="px-1 text-[11px] leading-5 text-slate-500">District boundaries are administrative reference data. A hand-drawn field boundary is an approximate outline from map clicks; verify it on the ground before using it for official land measurement. When a fresh GPM IMERG Late cache is installed, a drawn field uses equal-area cell intersections if at least 80% of the polygon has valid coverage. Point selection uses the nearest ~10 km cell. If IMERG coverage is unavailable, NASA POWER (~55 km) is used as a clearly labelled point fallback; it is not a polygon average.</p>
    </div>
  );
}
