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
import { getDict, type Lang } from "@/i18n";
import { averageFixes, type Fix } from "@/lib/gps-average";
import { polygonSelfIntersects, pointInDistricts } from "@/lib/field-geometry";
import { FIELD_SURVEY_CONFIG } from "@/config/field-survey";
import type { FieldAssessmentResponse } from "@/types/safefield";
import {
  WeatherCard,
  VegetationCard,
  SoilMoistureCard,
  FieldSummaryCard,
  SignalCoverageCard,
  RainImpactCard,
  StressCard,
  AskCard,
} from "@/components/HomeDashboardCards";
import {
  Navigation, Compass, Pencil, Undo2, Trash2,
  Check, LocateFixed, MousePointer2, Search, Loader2, X, MapPin,
  Footprints, Info, ChevronDown, CalendarDays, Sprout, Layers3,
} from "lucide-react";

interface ScreenAHomeProps {
  selectedLat: number;
  selectedLon: number;
  data: FieldAssessmentResponse | null;
  loading: boolean;
  error: string | null;
  onLocationSelect: (lat: number, lon: number, name: string) => void;
  onFieldPolygonSelect: (polygon: [number, number][] | null) => void;
  onSandOverrideChange: (value: number | null) => void;
  onRunAssessment: () => void;
  onOpenField: () => void;
  lang: Lang;
  fieldPolygon?: [number, number][] | null;
}

type DrawMode = "select" | "draw";
type WalkCorner = { lat: number; lon: number; accuracy: number };
type WalkStatus = "idle" | "waiting" | "live" | "unavailable";
type SurveyPointType = "corner" | "water" | "wet" | "erosion" | "soil" | "note";
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

function polygonCentroid(points: [number, number][]): [number, number] {
  let twiceArea = 0;
  let centroidLon = 0;
  let centroidLat = 0;
  for (let index = 0; index < points.length; index++) {
    const [lon1, lat1] = points[index];
    const [lon2, lat2] = points[(index + 1) % points.length];
    const cross = lon1 * lat2 - lon2 * lat1;
    twiceArea += cross;
    centroidLon += (lon1 + lon2) * cross;
    centroidLat += (lat1 + lat2) * cross;
  }
  if (Math.abs(twiceArea) < 1e-12) {
    const sum = points.reduce((acc, point) => [acc[0] + point[0], acc[1] + point[1]], [0, 0]);
    return [sum[0] / points.length, sum[1] / points.length];
  }
  return [centroidLon / (3 * twiceArea), centroidLat / (3 * twiceArea)];
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
  data,
  loading,
  error,
  onLocationSelect,
  onFieldPolygonSelect,
  onSandOverrideChange,
  onRunAssessment,
  onOpenField,
  lang,
  fieldPolygon,
}: ScreenAHomeProps) {
  const t = getDict(lang);
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
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [todayLabel, setTodayLabel] = useState("");

  // Walk method state: the farmer stands on each field corner and marks it.
  // Corners feed the same draw pipeline (drawPoints/user-field layer), plus a
  // live GPS watch that shows the walking position and per-corner accuracy.
  const [walkCorners, setWalkCorners] = useState<WalkCorner[]>([]);
  const [surveyPoints, setSurveyPoints] = useState<Array<{id:number;lat:number;lon:number;type:SurveyPointType;accuracy:number}>>([]);
  const [surveyPointsLoaded, setSurveyPointsLoaded] = useState(false);
  const [pendingSurveyFix, setPendingSurveyFix] = useState<{lat:number;lon:number;accuracy:number;used:number;rejected:number}|null>(null);
  const [pendingSoilSample, setPendingSoilSample] = useState<{lat:number;lon:number;accuracy:number}|null>(null);
  const [soilSandInput, setSoilSandInput] = useState("");
  const [surveyCollecting, setSurveyCollecting] = useState(false);
  const [surveyFixCount, setSurveyFixCount] = useState(0);
  const surveyWatchRef = useRef<number|null>(null);
  const surveyFixesRef = useRef<Fix[]>([]);
  const surveyPointIdRef = useRef(0);
  const surveyTriggerRef = useRef<HTMLButtonElement>(null);
  const surveyDialogRef = useRef<HTMLElement>(null);
  const surveyWasOpenRef = useRef(false);
  const surveyMarkersRef = useRef<MapLibreMarker[]>([]);
  const [gpsReceipt, setGpsReceipt] = useState<{used:number;rejected:number}|null>(null);
  const [walkRequesting, setWalkRequesting] = useState(false);
  const [walkStatus, setWalkStatus] = useState<WalkStatus>("idle");
  const [walkLiveAccuracy, setWalkLiveAccuracy] = useState<number | null>(null);
  const walkCornersRef = useRef<WalkCorner[]>([]);
  const walkWatchRef = useRef<number | null>(null);
  const walkDotRef = useRef<MapLibreMarker | null>(null);

  // Place/city/road search (Nominatim, restricted to Nepal).
  type PlaceResult = { title: string; subtitle: string; lat: number; lon: number };
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<PlaceResult[]>([]);
  const [searchStatus, setSearchStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const searchAbortRef = useRef<AbortController | null>(null);

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
    walkTitle: lang === "ne" ? "हिँडेर कुना मार्क्ने विधि" : "Walk method",
    walkInfo: lang === "ne" ? "GPS केही मिटरसम्म गलत हुन सक्छ। प्रत्येक कुनाको सटीकता देखाइन्छ।" : "GPS can be off by several meters. Each corner shows its accuracy.",
    walkPrivacy: lang === "ne" ? "यसका लागि तपाईंको स्थान अनुमति चाहिन्छ। तपाईंको खेतको डाटा तपाईंकै फोनमै बस्छ।" : "This needs your location permission. Your field stays on your phone.",
    walkMark: lang === "ne" ? "यो कुना मार्क गर्नुहोस्" : "Mark this corner",
    walkUndo: lang === "ne" ? "कुना हटाउनुहोस्" : "Undo corner",
    walkFinish: lang === "ne" ? "खेत पूरा गर्नुहोस्" : "Finish field",
    walkNeedCorners: lang === "ne" ? "कम्तीमा ३ कुना चाहिन्छ।" : "At least 3 corners are needed.",
    walkWaiting: lang === "ne" ? "GPS पर्खिँदै…" : "Waiting for GPS…",
    walkUnavailable: lang === "ne" ? "अनुपलब्ध" : "Unavailable",
    walkCorner: lang === "ne" ? "कुना" : "Corner",
    walkSaved: lang === "ne" ? "खेतको सीमा सुरक्षित भयो।" : "Field boundary saved.",
    walkModePill: lang === "ne" ? "हिँड्ने क्रममा — प्रत्येक कुनामा उभिएर मार्क गर्नुहोस्" : "Walk mode — stand on each corner and mark it",
    searchLabel: t.searchLabel,
    searchPlaceholder: t.searchPlaceholder,
    searchNoResults: t.searchNoResults,
    searchError: t.searchError,
    fieldMappingBadge: t.fieldMappingBadge,
    subtitleExtra: t.subtitleExtra,
    loadingDistricts: t.loadingDistricts,
    chooseDistrict: t.chooseDistrict,
    mapLayers: t.mapLayers,
    loadingMap: t.loadingMap,
    drawingMode: t.drawingMode,
    selectedLocation: t.selectedLocation,
    dragPin: t.dragPin,
    districtBoundaries: t.districtBoundaries,
    districtsAvailable: t.districtsAvailable,
    districtsLoading: t.districtsLoading,
    nextField: t.nextField,
    satelliteUnavailableTitle: t.satelliteUnavailableTitle,
    satelliteTitle: t.satelliteTitle,
    attributionSatellite: t.mapAttributionSatellite,
    attributionStreets: t.mapAttributionStreets,
    errorDistrictsFile: t.errorDistrictsFile,
    errorMarkerOutside: t.errorMarkerOutside,
    locationManuallyAdjusted: t.locationManuallyAdjusted,
    locationAdjusted: t.locationAdjusted,
    errorClickOutside: t.errorClickOutside,
    errorTooManyVertices: t.errorTooManyVertices,
    locationSelected: t.locationSelected,
    errorSatellite: t.errorSatellite,
    errorTiles: t.errorTiles,
    locationDistrictCentre: t.locationDistrictCentre,
    locationDrawn: t.locationDrawn,
    errorGeolocationUnsupported: t.errorGeolocationUnsupported,
    errorGpsOutside: t.errorGpsOutside,
    locationGps: t.locationGps,
    gpsFix: t.gpsFix,
    errorGpsDenied: t.errorGpsDenied,
    errorGpsUnavailable: t.errorGpsUnavailable,
    errorGpsTimeout: t.errorGpsTimeout,
    searchDistrictLabel: lang === "ne" ? "खोज्नुहोस् वा जिल्ला छान्नुहोस्" : "Search or choose district",
  };

  // The advanced search/district section is collapsed on phones and expanded
  // on desktop, matching the farmer-first mobile layout. DOM-driven so the
  // user can still toggle it freely afterwards.
  const advDetailsRef = useRef<HTMLDetailsElement | null>(null);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 640px)");
    const apply = () => { if (advDetailsRef.current) advDetailsRef.current.open = mq.matches; };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setTodayLabel(new Intl.DateTimeFormat(lang === "ne" ? "ne-NP" : "en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
      }).format(new Date()));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [lang]);

  useEffect(() => {
    let restoredPoints: Array<{id:number;lat:number;lon:number;type:SurveyPointType;accuracy:number}> = [];
    try {
      const raw = window.localStorage.getItem("safefield_survey_points");
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          restoredPoints = parsed.filter((point): point is {id:number;lat:number;lon:number;type:SurveyPointType;accuracy:number} =>
            point && Number.isSafeInteger(point.id) && Number.isFinite(point.lat) && Number.isFinite(point.lon) &&
            Number.isFinite(point.accuracy) && ["water","wet","erosion","soil","note"].includes(point.type)
          );
        }
      }
    } catch { /* Invalid or unavailable local storage leaves survey points empty. */ }

    // Restore after the effect turn and cancel if this component unmounts first.
    const timer = window.setTimeout(() => {
      surveyPointIdRef.current = restoredPoints.reduce((max, point) => Math.max(max, point.id), 0);
      setSurveyPoints(restoredPoints);
      setSurveyPointsLoaded(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!surveyPointsLoaded) return;
    try { window.localStorage.setItem("safefield_survey_points", JSON.stringify(surveyPoints)); }
    catch { /* Field survey remains usable when storage is unavailable or full. */ }
  }, [surveyPoints, surveyPointsLoaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    surveyMarkersRef.current.forEach((marker) => marker.remove());
    surveyMarkersRef.current = [];
    for (const point of surveyPoints) {
      const element = document.createElement("div");
      element.className = "flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-brand-blue text-sm font-bold text-white shadow-float";
      element.textContent = ({corner:"C",water:"W",wet:"L",erosion:"E",soil:"S",note:"N"} as const)[point.type];
      surveyMarkersRef.current.push(new MapLibreMarker({element}).setLngLat([point.lon,point.lat]).addTo(map));
    }
  }, [surveyPoints, mapReady]);

  useEffect(() => {
    if (!pendingSurveyFix && !pendingSoilSample) { if (surveyWasOpenRef.current) { surveyWasOpenRef.current = false; surveyTriggerRef.current?.focus(); } return; }
    surveyWasOpenRef.current = true;
    const handleKeys = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setPendingSurveyFix(null); setPendingSoilSample(null); return; }
      if (event.key !== "Tab" || !surveyDialogRef.current) return;
      const items = surveyDialogRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex='-1'])");
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", handleKeys);
    return () => window.removeEventListener("keydown", handleKeys);
  }, [pendingSurveyFix, pendingSoilSample]);

  useEffect(() => { onLocationSelectRef.current = onLocationSelect; }, [onLocationSelect]);
  useEffect(() => { drawPointsRef.current = drawPoints; }, [drawPoints]);
  useEffect(() => { districtsRef.current = districts; }, [districts]);

  // Live GPS watch for the walk method: keeps a small dot on the map and the
  // accuracy pill up to date while the farmer walks between corners.
  const stopSurveyCollection = useCallback(() => {
    if (surveyWatchRef.current !== null && typeof navigator !== "undefined" && navigator.geolocation) navigator.geolocation.clearWatch(surveyWatchRef.current);
    surveyWatchRef.current = null; setSurveyCollecting(false);
  }, []);

  const stopWalkWatch = useCallback(() => {
    if (walkWatchRef.current !== null && typeof navigator !== "undefined" && navigator.geolocation) {
      navigator.geolocation.clearWatch(walkWatchRef.current);
    }
    walkWatchRef.current = null;
    walkDotRef.current?.remove();
    walkDotRef.current = null;
  }, []);

  const startWalkWatch = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setWalkStatus("unavailable");
      return;
    }
    if (walkWatchRef.current !== null) return;
    walkWatchRef.current = navigator.geolocation.watchPosition(
      (position) => {
        setWalkStatus("live");
        setWalkLiveAccuracy(position.coords.accuracy);
        const map = mapRef.current;
        if (!map) return;
        if (!walkDotRef.current) {
          const dot = document.createElement("div");
          dot.className = "h-4 w-4 rounded-full border-[3px] border-white bg-info shadow-float";
          walkDotRef.current = new MapLibreMarker({ element: dot })
            .setLngLat([position.coords.longitude, position.coords.latitude])
            .addTo(map);
        } else {
          walkDotRef.current.setLngLat([position.coords.longitude, position.coords.latitude]);
        }
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) setWalkStatus("unavailable");
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 2000 }
    );
  }, []);

  // Debounced place search; results are limited to Nepal by the provider.
  useEffect(() => {
    const query = searchQuery.trim();
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      if (query.length < 3) {
        searchAbortRef.current?.abort();
        setSearchResults([]);
        setSearchStatus("idle");
        return;
      }
      searchAbortRef.current?.abort();
      searchAbortRef.current = controller;
      setSearchStatus("loading");
      try {
        const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&countrycodes=np&q=${encodeURIComponent(query)}`;
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: unknown = await res.json();
        const rows = Array.isArray(json) ? json as Array<Record<string, unknown>> : [];
        const results: PlaceResult[] = [];
        for (const row of rows) {
          const lat = Number(row.lat);
          const lon = Number(row.lon);
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
          if (lat < 26.0 || lat > 30.8 || lon < 79.8 || lon > 88.5) continue;
          const displayName = typeof row.display_name === "string" ? row.display_name : "";
          const title = (typeof row.name === "string" && row.name.trim()) || displayName.split(",")[0].trim() || query;
          const rest = displayName.includes(",") ? displayName.slice(displayName.indexOf(",") + 1).trim() : "";
          const subtitle = rest.replace(/,?\s*Nepal\s*$/i, "");
          if (!results.some((item) => item.title === title && item.subtitle === subtitle)) {
            results.push({ title, subtitle, lat, lon });
          }
        }
        setSearchResults(results);
        setSearchStatus("done");
      } catch (err) {
        if (controller.signal.aborted) return;
        setSearchResults([]);
        setSearchStatus("error");
        console.error("Location search failed:", err);
      }
    }, query.length < 3 ? 0 : 500);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [searchQuery]);

  const selectSearchResult = (result: PlaceResult) => {
    setSearchQuery("");
    setSearchResults([]);
    setSearchStatus("idle");
    setDistrictName("");
    setLocationName(result.title);
    onLocationSelectRef.current(result.lat, result.lon, result.title);
    onFieldPolygonSelect(null);
    markerRef.current?.setLngLat([result.lon, result.lat]);
    mapRef.current?.flyTo({ center: [result.lon, result.lat], zoom: 14, essential: true });
  };
  useEffect(() => { drawModeRef.current = drawMode; }, [drawMode]);
  useEffect(() => { mapStyleRef.current = mapStyle; }, [mapStyle]);
  // Mirror the latest translated strings for long-lived map/fetch callbacks so
  // effect dependencies stay stable across language switches.
  const copyRef = useRef(copy);
  useEffect(() => { copyRef.current = copy; });
  useEffect(() => {
    selectedCoordinatesRef.current = { lat: selectedLat, lon: selectedLon };
  }, [selectedLat, selectedLon]);

  // Remember where the map was initialized so a restored session (applied by
  // the parent shortly after hydration) can re-center the view once.
  const initialMapCenterRef = useRef<{ lat: number; lon: number } | null>(null);
  const fieldPolygonRef = useRef(fieldPolygon);
  useEffect(() => { fieldPolygonRef.current = fieldPolygon; });
  const sessionRestoredRef = useRef(false);

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
        if (!cancelled) setMapError(copyRef.current.errorDistrictsFile);
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

  // One-shot session restore: shortly after mount the parent has applied the
  // persisted coordinates, so re-center the map and redraw a stored field.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (sessionRestoredRef.current) return;
      sessionRestoredRef.current = true;
      const map = mapRef.current;
      const initial = initialMapCenterRef.current;
      if (!map || !initial) return;
      const restored = selectedCoordinatesRef.current;
      const moved = Math.abs(restored.lat - initial.lat) > 1e-9 || Math.abs(restored.lon - initial.lon) > 1e-9;
      if (moved) {
        markerRef.current?.setLngLat([restored.lon, restored.lat]);
        map.jumpTo({ center: [restored.lon, restored.lat], zoom: 12 });
      }
      const stored = fieldPolygonRef.current;
      if (Array.isArray(stored) && stored.length >= 4) {
        const closing = stored[stored.length - 1];
        const first = stored[0];
        const open = closing[0] === first[0] && closing[1] === first[1] ? stored.slice(0, -1) : stored;
        setDrawPoints(open as [number, number][]);
        setFieldArea(polygonAreaHectares(open as [number, number][]));
        updateDrawLayer(map, open as [number, number][]);
      }
    }, 180);
    return () => clearTimeout(timer);
  }, [updateDrawLayer]);

  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container) return;

    setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
    const initialLocation = selectedCoordinatesRef.current;
    initialMapCenterRef.current = { lat: initialLocation.lat, lon: initialLocation.lon };
    const map = createMap(container, [initialLocation.lon, initialLocation.lat]);
    mapRef.current = map;
    map.addControl(new NavigationControl({ visualizePitch: true }), "top-right");
    map.addControl(new ScaleControl({ unit: "metric" }), "bottom-right");

    const marker = new MapLibreMarker({ color: "#087BFA", draggable: true })
      .setLngLat([initialLocation.lon, initialLocation.lat]).addTo(map);
    markerRef.current = marker;
    marker.on("dragend", () => {
      const point = marker.getLngLat();
      if (point.lng < 80.0 || point.lng > 88.3 || point.lat < 26.3 || point.lat > 30.5) {
        marker.setLngLat([selectedCoordinatesRef.current.lon, selectedCoordinatesRef.current.lat]);
        setMapError(copyRef.current.errorMarkerOutside);
        return;
      }
      onLocationSelectRef.current(point.lat, point.lng, copyRef.current.locationManuallyAdjusted);
      onFieldPolygonSelect(null);
      setDistrictName("");
      setLocationName(`${copyRef.current.locationAdjusted} · ${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`);
      setGpsAccuracy(null);
    });

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
          paint: { "fill-color": "#64748B", "fill-opacity": 0.05 },
        });
        map.addLayer({
          id: "district-lines", type: "line", source: "nepal-districts",
          paint: { "line-color": "#64748B", "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.7, 11, 1.6], "line-opacity": 0.35 },
        });
      }
      if (!map.getSource("user-field")) {
        map.addSource("user-field", { type: "geojson", data: EMPTY_FEATURES });
        map.addLayer({
          id: "user-field-fill", type: "fill", source: "user-field",
          paint: { "fill-color": "#39D80B", "fill-opacity": 0.18 },
        });
        map.addLayer({
          id: "user-field-outline", type: "line", source: "user-field",
          paint: { "line-color": "#079447", "line-width": 2.5 },
        });
        map.addLayer({
          id: "user-field-points", type: "circle", source: "user-field",
          filter: ["==", ["geometry-type"], "Point"],
          paint: {
            "circle-radius": 6,
            "circle-color": "#ffffff",
            "circle-stroke-color": "#079447",
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
      if (lng < 80.0 || lng > 88.3 || lat < 26.3 || lat > 30.5) {
        setMapError(copyRef.current.errorClickOutside);
        return;
      }
      if (drawModeRef.current === "draw") {
        if (drawPointsRef.current.length >= 200) {
          setMapError(copyRef.current.errorTooManyVertices);
          return;
        }
        const next = [...drawPointsRef.current, [lng, lat] as [number, number]];
        drawPointsRef.current = next;
        setDrawPoints(next);
        updateDrawLayer(map, next);
        return;
      }
      // A normal map tap always drops a pin; district selection is handled by the picker.
      onLocationSelectRef.current(lat, lng, `${copyRef.current.locationSelected} (${lat.toFixed(4)}, ${lng.toFixed(4)})`);
      onFieldPolygonSelect(null);
      setDistrictName("");
      setLocationName(`${copyRef.current.locationSelected} · ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
      marker.setLngLat([lng, lat]);
    });

    map.on("error", (event) => {
      console.error("MapLibre map error:", event.error);
      if (isSatelliteSourceError(event)) {
        setSatelliteAvailable(false);
        setMapStyle("streets");
        setMapError(copyRef.current.errorSatellite);
        return;
      }
      setMapReady(true);
      setMapError(copyRef.current.errorTiles);
    });

    return () => {
      stopWalkWatch();
      if (surveyWatchRef.current !== null && typeof navigator !== "undefined" && navigator.geolocation) navigator.geolocation.clearWatch(surveyWatchRef.current);
      surveyWatchRef.current = null;
      surveyMarkersRef.current.forEach((surveyMarker)=>surveyMarker.remove()); surveyMarkersRef.current=[];
      marker.remove();
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      setMapReady(false);
    };
  // Keep one OpenFreeMap vector map; satellite imagery is toggled as a raster overlay.
  }, [updateDrawLayer, onFieldPolygonSelect, stopWalkWatch, stopSurveyCollection]);

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
  }, [selectedLat, selectedLon, drawMode, onFieldPolygonSelect]);

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
    setLocationName(`${name} · ${copy.locationDistrictCentre}`);
    onLocationSelect(lat, lon, `${name} District`);
    onFieldPolygonSelect(null);
    markerRef.current?.setLngLat([lon, lat]);
    mapRef.current?.fitBounds([[bounds.minLon, bounds.minLat], [bounds.maxLon, bounds.maxLat]], { padding: 55, maxZoom: 9, essential: true });
  };

  const beginDrawing = () => {
    // Starting a tap-drawing retires any walk session so the two boundary
    // methods never mix points.
    stopWalkWatch();
    walkCornersRef.current = [];
    setWalkCorners([]);
    setWalkStatus("idle");
    setWalkLiveAccuracy(null);
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
    if (polygonSelfIntersects(drawPoints)) { setMapError(lang === "ne" ? "खेतको सीमा आफैं काटिएको छ। कुनाहरू सच्याउनुहोस्।" : "The field boundary crosses itself. Adjust the corners before finishing."); return; }
    const geometries = districts.map((feature) => feature.geometry);
    if (geometries.length && drawPoints.some((point) => !pointInDistricts(point, geometries))) { setMapError(lang === "ne" ? "सीमाको केही भाग नेपालका उपलब्ध जिल्ला सीमाबाहिर छ।" : "Part of this boundary falls outside the available Nepal district boundaries."); return; }
    setMapError(null);
    const area = polygonAreaHectares(drawPoints);
    setFieldArea(area);
    drawModeRef.current = "select";
    setDrawMode("select");
    if (mapRef.current) mapRef.current.getCanvas().style.cursor = "";
    const [lon, lat] = polygonCentroid(drawPoints);
    setLocationName(copy.locationDrawn);
    onLocationSelect(lat, lon, copy.locationDrawn);
    onFieldPolygonSelect([...drawPoints, drawPoints[0]]);
    markerRef.current?.setLngLat([lon, lat]);
    mapRef.current?.fitBounds(drawPoints.reduce((bounds, point) => bounds.extend(point), new LngLatBounds(drawPoints[0], drawPoints[0])), { padding: 60, maxZoom: 16 });
  };

  const handleUseGps = () => {
    if (!navigator.geolocation) {
      setMapError(copy.errorGeolocationUnsupported);
      return;
    }
    setGpsLoading(true);
    setMapError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;
        setGpsLoading(false);
        if (lat < 26.3 || lat > 30.5 || lon < 80.0 || lon > 88.3) {
          setMapError(copy.errorGpsOutside);
          return;
        }
        setGpsAccuracy(position.coords.accuracy);
        setDistrictName("");
        onLocationSelect(lat, lon, copy.locationGps);
        onFieldPolygonSelect(null);
        setLocationName(`${copy.gpsFix} · ±${Math.round(position.coords.accuracy)} m`);
        markerRef.current?.setLngLat([lon, lat]);
        mapRef.current?.flyTo({ center: [lon, lat], zoom: 17 });
      },
      (error) => {
        setGpsLoading(false);
        const reason = error.code === error.PERMISSION_DENIED
          ? copy.errorGpsDenied
          : error.code === error.POSITION_UNAVAILABLE
            ? copy.errorGpsUnavailable
            : copy.errorGpsTimeout;
        setMapError(reason);
      },
      { enableHighAccuracy: true, timeout: 25000, maximumAge: 0 }
    );
  };

  // Walk method: one fresh high-accuracy fix per corner press so the recorded
  // corner matches where the farmer is standing at that moment.
  const markWalkCorner = () => {
    if (!navigator.geolocation) {
      setWalkStatus("unavailable");
      setMapError(copyRef.current.errorGeolocationUnsupported);
      return;
    }
    setWalkRequesting(true);
    setWalkStatus("waiting");
    setMapError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setWalkRequesting(false);
        const { latitude: lat, longitude: lon, accuracy } = position.coords;
        if (lat < 26.3 || lat > 30.5 || lon < 80.0 || lon > 88.3) {
          setWalkStatus("unavailable");
          setMapError(copyRef.current.errorGpsOutside);
          return;
        }
        // The first marked corner also retires any in-progress tap-drawing so
        // the two boundary methods never mix points.
        if (drawModeRef.current === "draw") {
          drawModeRef.current = "select";
          setDrawMode("select");
          if (mapRef.current) mapRef.current.getCanvas().style.cursor = "";
        }
        if (walkCornersRef.current.length === 0) {
          drawPointsRef.current = [];
          setDrawPoints([]);
          setFieldArea(null);
          onFieldPolygonSelect(null);
        }
        const next = [...drawPointsRef.current, [lon, lat] as [number, number]];
        drawPointsRef.current = next;
        setDrawPoints(next);
        if (mapRef.current) {
          updateDrawLayer(mapRef.current, next);
          const center = mapRef.current.getCenter();
          if (Math.abs(center.lng - lon) > 0.002 || Math.abs(center.lat - lat) > 0.002) {
            mapRef.current.easeTo({ center: [lon, lat], duration: 600 });
          }
        }
        walkCornersRef.current = [...walkCornersRef.current, { lat, lon, accuracy }];
        setWalkCorners(walkCornersRef.current);
        setWalkStatus("live");
        setWalkLiveAccuracy(accuracy);
        startWalkWatch();
      },
      (error) => {
        setWalkRequesting(false);
        const denied = error.code === error.PERMISSION_DENIED;
        setWalkStatus(denied ? "unavailable" : "idle");
        const reason = denied
          ? copyRef.current.errorGpsDenied
          : error.code === error.POSITION_UNAVAILABLE
            ? copyRef.current.errorGpsUnavailable
            : copyRef.current.errorGpsTimeout;
        setMapError(reason);
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  };

  const startStandSurvey = () => {
    if (!navigator.geolocation) { setMapError(copyRef.current.errorGeolocationUnsupported); return; }
    stopSurveyCollection(); surveyFixesRef.current = []; setSurveyFixCount(0); setPendingSurveyFix(null); setSurveyCollecting(true);
    surveyWatchRef.current = navigator.geolocation.watchPosition((position) => {
      surveyFixesRef.current = [...surveyFixesRef.current, {lat:position.coords.latitude,lon:position.coords.longitude,accuracyM:position.coords.accuracy,timestamp:position.timestamp}];
      setSurveyFixCount(surveyFixesRef.current.length);
      if (surveyFixesRef.current.length < FIELD_SURVEY_CONFIG.gpsFixCount) return;
      const result = averageFixes(surveyFixesRef.current, {
        maxAccuracyM: FIELD_SURVEY_CONFIG.maxGpsAccuracyMeters,
        minFixes: FIELD_SURVEY_CONFIG.minGoodGpsFixes,
        madK: FIELD_SURVEY_CONFIG.madK,
        madFloorM: FIELD_SURVEY_CONFIG.madFloorM,
        goodM: FIELD_SURVEY_CONFIG.goodM,
        fairM: FIELD_SURVEY_CONFIG.fairM,
      });
      stopSurveyCollection();
      if (!result) {
        setMapError(lang === "ne" ? "पर्याप्त राम्रो GPS फिक्स प्राप्त भएन। खुला आकाश भएको ठाउँमा पुनः प्रयास गर्नुहोस्।" : "Not enough good GPS fixes. Move to open sky and try again.");
        return;
      }
      if (result.lat < 26.3 || result.lat > 30.5 || result.lon < 80 || result.lon > 88.3) {
        setMapError(copyRef.current.errorGpsOutside);
        return;
      }
      setPendingSurveyFix({
        lat: result.lat,
        lon: result.lon,
        accuracy: result.estimatedErrorM,
        used: result.usedFixes,
        rejected: result.rejectedFixes,
      });
      setMapError(null);
    }, (error) => { stopSurveyCollection(); setMapError(error.code === error.PERMISSION_DENIED ? copyRef.current.errorGpsDenied : copyRef.current.errorGpsUnavailable); }, {enableHighAccuracy:true,maximumAge:0,timeout:30000});
  };
  const saveSurveyPoint = (type: SurveyPointType) => {
    if (!pendingSurveyFix) return; const point = pendingSurveyFix;
    if (type === "corner") {
      const next = [...drawPointsRef.current,[point.lon,point.lat] as [number,number]];
      if (next.length > FIELD_SURVEY_CONFIG.maxPolygonVertices) { setMapError(copyRef.current.errorTooManyVertices); return; }
      drawPointsRef.current=next; setDrawPoints(next); walkCornersRef.current=[...walkCornersRef.current,{lat:point.lat,lon:point.lon,accuracy:point.accuracy}]; setWalkCorners(walkCornersRef.current); if(mapRef.current) updateDrawLayer(mapRef.current,next);
    } else {
      setSurveyPoints((old)=>[...old,{id:++surveyPointIdRef.current,lat:point.lat,lon:point.lon,type,accuracy:point.accuracy}]);

    }
    setGpsReceipt({used:point.used,rejected:point.rejected});
    if (type === "soil") { setPendingSoilSample({lat:point.lat,lon:point.lon,accuracy:point.accuracy}); setSoilSandInput(""); }
    setPendingSurveyFix(null); markerRef.current?.setLngLat([point.lon,point.lat]); mapRef.current?.easeTo({center:[point.lon,point.lat],duration:500});
  };

  const saveSoilSample = () => {
    if (!pendingSoilSample) return;
    const raw = soilSandInput.trim();
    if (raw) {
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0 || value > 100) return;
      onSandOverrideChange(value);
      try { window.localStorage.setItem("safefield_soil_sample_input", JSON.stringify({kind:"farmer_input",sand_percent:value,accuracy_m:pendingSoilSample.accuracy,recorded_at_utc:new Date().toISOString()})); }
      catch { /* Local assessment input remains active for this session. */ }
    }
    setPendingSoilSample(null);
  };

  const undoWalkCorner = () => {
    if (!walkCornersRef.current.length) return;
    walkCornersRef.current = walkCornersRef.current.slice(0, -1);
    setWalkCorners(walkCornersRef.current);
    const next = drawPointsRef.current.slice(0, -1);
    drawPointsRef.current = next;
    setDrawPoints(next);
  };

  const clearWalkCorners = () => {
    stopWalkWatch();
    walkCornersRef.current = [];
    setWalkCorners([]);
    setWalkStatus("idle");
    setWalkLiveAccuracy(null);
    drawPointsRef.current = [];
    setDrawPoints([]);
    setFieldArea(null);
    onFieldPolygonSelect(null);
    if (mapRef.current) updateDrawLayer(mapRef.current, []);
  };

  const finishWalkField = () => {
    if (walkCornersRef.current.length < 3) return;
    finishDrawing();
    stopWalkWatch();
    walkCornersRef.current = [];
    setWalkCorners([]);
    setWalkStatus("idle");
    setWalkLiveAccuracy(null);
  };

  // Status line inside the walk box: progress until three corners exist, then
  // a ready-to-finish confirmation. A boundary saved earlier (drawn, walked or
  // restored from a previous visit) is acknowledged instead.
  const boundarySaved = fieldArea !== null || (Array.isArray(fieldPolygon) && fieldPolygon.length >= 4);
  const walkStatusBox = walkCorners.length === 0
    ? (boundarySaved ? copy.walkSaved : copy.walkNeedCorners)
    : walkCorners.length < 3
      ? `${walkCorners.length} / 3 · ${copy.walkNeedCorners}`
      : lang === "ne"
        ? `${walkCorners.length} कुना मार्क भए — खेत पूरा गर्न सकिन्छ।`
        : `${walkCorners.length} ${walkCorners.length === 1 ? "corner" : "corners"} marked — ready to finish the field.`;

  return (
    <>
      {pendingSoilSample && <div className="fixed inset-0 z-[120] flex items-end justify-center bg-charcoal/60 p-3 sm:items-center"><section ref={surveyDialogRef} role="dialog" aria-modal="true" aria-labelledby="soil-sample-title" className="w-full max-w-md rounded-2xl bg-white p-5 shadow-sheet">
        <h2 id="soil-sample-title" className="text-xl font-bold text-ink">{t.surveySoilEntryTitle}</h2>
        <p className="mt-2 text-base text-ink-soft">{t.surveySoilEntryHelp}</p>
        <label className="mt-4 block text-base font-semibold text-ink">{t.surveySandPercent}<input type="number" min="0" max="100" step="1" inputMode="decimal" value={soilSandInput} onChange={(event)=>setSoilSandInput(event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-line px-4 text-base" placeholder={t.surveySandPlaceholder}/></label>
        <div className="mt-4 flex gap-2"><button type="button" onClick={saveSoilSample} className="min-h-12 flex-1 rounded-full bg-action px-4 text-base font-bold text-white transition active:scale-[0.98]">{t.surveySaveSoilInput}</button><button type="button" onClick={()=>setPendingSoilSample(null)} className="min-h-12 rounded-full border border-line px-4 text-base font-semibold transition active:scale-[0.98]">{t.surveyCancel}</button></div>
      </section></div>}
      {pendingSurveyFix && <div className="fixed inset-0 z-[120] flex items-end justify-center bg-charcoal/60 p-3 sm:items-center"><section ref={surveyDialogRef} role="dialog" aria-modal="true" aria-labelledby="survey-point-title" className="w-full max-w-md rounded-2xl bg-white p-5 shadow-sheet">
        <h2 id="survey-point-title" className="text-xl font-bold text-ink">{t.surveyPointQuestion}</h2><p className="mt-2 text-base text-ink-soft">{t.surveyGpsAccuracy}: ±{Math.round(pendingSurveyFix.accuracy)} m</p>
        <div className="mt-4 grid grid-cols-2 gap-2">{([["corner",t.surveyCorner],["water",t.surveyWater],["wet",t.surveyWet],["erosion",t.surveyErosion],["soil",t.surveySoil],["note",t.surveyOther]] as const).map(([type,label])=><button key={type} type="button" onClick={()=>saveSurveyPoint(type)} className="min-h-12 rounded-xl border border-line bg-soft px-3 py-3 text-left text-base font-bold text-ink-soft transition hover:border-border-strong active:scale-[0.98]">{label}</button>)}</div>
        <button type="button" onClick={()=>setPendingSurveyFix(null)} className="mt-3 min-h-12 w-full rounded-full border border-line px-4 text-sm font-semibold text-ink-soft transition active:scale-[0.98]">{t.surveyCancel}</button>
      </section></div>}
    <div className="space-y-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2 rounded-full bg-brand-blue-soft px-3 py-1 text-[10px] font-bold uppercase tracking-[.15em] text-brand-blue-deep">
            <LocateFixed className="h-3.5 w-3.5" aria-hidden="true" /> {copy.fieldMappingBadge}
          </div>
          <h2 className="mt-2 text-3xl font-bold tracking-tight text-ink sm:text-4xl">{t.homeGreeting}</h2>
          <p className="mt-1.5 max-w-2xl text-sm leading-6 text-ink-soft">{t.homeSubtitle}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink-soft shadow-card">
              <MapPin className="h-3.5 w-3.5 text-action" aria-hidden="true" />
              {locationName}
            </span>
            {todayLabel ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink-soft shadow-card">
                <CalendarDays className="h-3.5 w-3.5 text-info" aria-hidden="true" />
                {todayLabel}
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3 self-start rounded-2xl border border-line bg-white px-3 py-2.5 shadow-card">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-growth text-[#102A18]">
            <Sprout className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-bold text-ink">{t.homeProfileName}</span>
            <span className="block text-[11px] text-ink-muted">{t.homeProfileRole}</span>
          </span>
        </div>
      </header>

      {(mapError || error) && (
        <div role="alert" className="rounded-xl border border-amber bg-amber-soft px-4 py-3 text-xs font-medium leading-5 text-amber-ink">
          {mapError || error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,300px)_minmax(0,1fr)_minmax(0,320px)]">
        <div className="order-2 space-y-4 xl:order-1">
          <WeatherCard data={data} loading={loading} t={t} />
          <VegetationCard data={data} t={t} />
          <SoilMoistureCard data={data} t={t} />
        </div>

        <div className="order-1 space-y-4 xl:order-2">
          <FieldSummaryCard
            data={data}
            loading={loading}
            fieldArea={fieldArea}
            locationName={locationName}
            onRunAssessment={onRunAssessment}
            onOpenField={onOpenField}
            t={t}
          />

          <section className="overflow-hidden rounded-2xl border border-line bg-white shadow-card">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-divider px-4 py-3">
              <h3 className="flex items-center gap-2 text-sm font-bold text-ink">
                <MapPin className="h-4 w-4 text-action" aria-hidden="true" />
                {t.homeMapTitle}
              </h3>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1 rounded-full border border-line bg-soft p-1">
                  <button type="button" onClick={() => setMapStyle("streets")} aria-pressed={mapStyle === "streets"} className={`min-h-9 rounded-full px-3 text-xs font-semibold transition active:scale-[0.98] ${mapStyle === "streets" ? "bg-brand-blue-deep text-white" : "text-ink-soft hover:text-ink"}`}>{copy.streets}</button>
                  <button type="button" onClick={() => { if (satelliteAvailable) setMapStyle("satellite"); }} disabled={!satelliteAvailable} aria-pressed={mapStyle === "satellite"} title={!satelliteAvailable ? copy.satelliteUnavailableTitle : copy.satelliteTitle} className={`min-h-9 rounded-full px-3 text-xs font-semibold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 ${mapStyle === "satellite" ? "bg-brand-blue-deep text-white" : "text-ink-soft hover:text-ink"}`}>{copy.satellite}</button>
                </div>
                <button type="button" onClick={() => setSetupOpen((open) => !open)} aria-expanded={setupOpen} className={`inline-flex min-h-9 items-center gap-2 rounded-full border px-3 text-xs font-bold transition active:scale-[0.98] ${setupOpen ? "border-[#C7E0FF] bg-brand-blue-soft text-brand-blue-deep" : "border-line bg-white text-ink-soft hover:bg-soft"}`}>
                  <Layers3 className="h-4 w-4" aria-hidden="true" />
                  {setupOpen ? t.homeMapSetupClose : t.homeMapSetupOpen}
                </button>
              </div>
            </div>
            <div className="relative h-[380px] sm:h-[520px]">
              <div ref={mapContainerRef} className="h-full w-full" />
              {!mapReady && (
                <div className="absolute inset-0 z-[2] flex items-center justify-center bg-warm/85 text-sm font-semibold text-ink-soft backdrop-blur-[2px]">{copy.loadingMap}</div>
              )}

              {setupOpen && (
                <div className="glass-surface absolute left-3 top-3 z-10 max-h-[calc(100%-24px)] w-[min(92%,370px)] overflow-y-auto rounded-xl p-3 sm:p-3.5">
                  <button onClick={handleUseGps} disabled={gpsLoading} className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-gradient-brand-deep px-4 text-base font-bold text-white shadow-float transition hover:opacity-95 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60">
                    <Navigation className={`h-5 w-5 shrink-0 ${gpsLoading ? "animate-pulse" : ""}`} /> {copy.gps}
                  </button>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <button onClick={() => { drawModeRef.current = "select"; setDrawMode("select"); if (mapRef.current) mapRef.current.getCanvas().style.cursor = ""; }} className={`inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full border px-3 py-2 text-center text-sm font-semibold leading-tight transition active:scale-[0.98] ${drawMode === "select" ? "border-[#C7E0FF] bg-brand-blue-soft text-brand-blue-deep" : "border-line bg-white text-ink-soft hover:bg-soft"}`}>
                      <MousePointer2 className="h-4 w-4 shrink-0" /> {copy.tap}
                    </button>
                    <button onClick={beginDrawing} className={`inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full border border-transparent px-3 py-2 text-center text-sm font-semibold leading-tight transition hover:opacity-95 active:scale-[0.98] bg-gradient-growth text-[#102A18] shadow-card ${drawMode === "draw" ? "ring-2 ring-[#079447]/40" : ""}`}>
                      <Pencil className="h-4 w-4 shrink-0" /> {copy.draw}
                    </button>
                  </div>
                  <details ref={advDetailsRef} className="mt-2.5 rounded-xl border border-line bg-white/85">
                    <summary className="flex min-h-11 cursor-pointer select-none items-center justify-between gap-2 px-3 py-2 text-xs font-bold uppercase tracking-wide text-ink-soft">
                      {copy.searchDistrictLabel}
                      <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
                    </summary>
                    <div className="px-3 pb-3">
                      <label className="block">
                        <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-ink-soft">{copy.searchLabel}</span>
                        <div className="relative">
                          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted">
                            {searchStatus === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                          </span>
                          <input
                            type="text"
                            value={searchQuery}
                            onChange={(event) => setSearchQuery(event.target.value)}
                            placeholder={copy.searchPlaceholder}
                            aria-label={copy.searchLabel}
                            className="h-11 w-full rounded-full border border-line bg-white pl-9 pr-9 text-sm font-medium text-ink outline-none transition placeholder:font-normal placeholder:text-ink-muted focus:border-action focus:ring-4 focus:ring-action/15"
                          />
                          {searchQuery && (
                            <button
                              type="button"
                              onClick={() => setSearchQuery("")}
                              aria-label="Clear search"
                              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-ink-muted transition hover:bg-soft hover:text-ink-soft active:scale-[0.98]"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          )}
                          {searchQuery.trim().length >= 3 && (searchStatus === "done" || searchStatus === "error") && (
                            <div className="absolute inset-x-0 top-full z-30 mt-1.5 max-h-60 overflow-y-auto rounded-lg border border-divider bg-white p-1 shadow-float">
                              {searchStatus === "error" && (
                                <p className="px-3 py-2.5 text-xs leading-5 text-danger">{copy.searchError}</p>
                              )}
                              {searchStatus === "done" && searchResults.length === 0 && (
                                <p className="px-3 py-2.5 text-xs leading-5 text-ink-muted">{copy.searchNoResults}</p>
                              )}
                              {searchResults.map((result) => (
                                <button
                                  key={`${result.title}-${result.lat}-${result.lon}`}
                                  type="button"
                                  onClick={() => selectSearchResult(result)}
                                  className="flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left transition hover:bg-brand-blue-soft/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action active:scale-[0.98]"
                                >
                                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-action" aria-hidden="true" />
                                  <span className="min-w-0">
                                    <span className="block truncate text-sm font-bold text-ink">{result.title}</span>
                                    {result.subtitle && <span className="block truncate text-xs text-ink-muted">{result.subtitle}</span>}
                                  </span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </label>
                      <label className="mt-2.5 block">
                        <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-ink-soft">{copy.district}</span>
                        <select value={districtName} onChange={(event) => selectDistrict(event.target.value)} disabled={districtLoading || districts.length === 0}
                          className="h-11 w-full rounded-full border border-line bg-white px-3 text-sm font-medium text-ink outline-none transition focus:border-action focus:ring-4 focus:ring-action/15">
                          <option value="">{districtLoading ? copy.loadingDistricts : copy.chooseDistrict}</option>
                          {[...districts].sort((a,b) => (a.properties?.DISTRICT ?? "").localeCompare(b.properties?.DISTRICT ?? "")).map((item) => (
                            <option key={item.properties?.DISTRICT} value={item.properties?.DISTRICT}>{item.properties?.DISTRICT}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </details>
                </div>
              )}

              <div className="glass-surface-dark pointer-events-none absolute right-3 top-3 z-[6] hidden w-[210px] rounded-xl p-3 text-white md:block">
                <p className="text-[10px] font-bold uppercase tracking-[.15em] text-white/60">{t.homeMapOverlay}</p>
                <p className="mt-1 truncate text-sm font-bold">{locationName}</p>
                <dl className="mt-2 space-y-1.5 text-[11px]">
                  <div className="flex items-center justify-between gap-2"><dt className="text-white/60">{t.homeFieldArea}</dt><dd className="tnum font-semibold">{fieldArea === null ? t.homeFieldNoArea : `${fieldArea.toFixed(2)} ha`}</dd></div>
                  <div className="flex items-center justify-between gap-2"><dt className="text-white/60">{t.homeFieldSlope}</dt><dd className="tnum font-semibold">{data?.elevation.slope_percent !== null && data?.elevation.slope_percent !== undefined ? `${data.elevation.slope_percent.toFixed(1)}%` : "—"}</dd></div>
                  <div className="flex items-center justify-between gap-2"><dt className="text-white/60">{t.homeFieldElevation}</dt><dd className="tnum font-semibold">{data?.elevation.elevation_meters !== null && data?.elevation.elevation_meters !== undefined ? `${Math.round(data.elevation.elevation_meters)} m` : "—"}</dd></div>
                  <div className="flex items-center justify-between gap-2"><dt className="text-white/60">{t.homeWetness}</dt><dd className="tnum font-semibold">{data?.power_summary.latest_surface_wetness !== null && data?.power_summary.latest_surface_wetness !== undefined ? `${Math.round(data.power_summary.latest_surface_wetness * 100)}%` : "—"}</dd></div>
                </dl>
                {!data ? <p className="mt-2 text-[10px] leading-4 text-white/70">{t.homeMapNoData}</p> : null}
                <p className="mt-2 border-t border-white/15 pt-1.5 text-[9px] leading-3 text-white/60">{t.homeMapAreaNote}</p>
              </div>

          {/* Floating drawing-mode bar with undo/clear/finish (8.5, 8.8) */}
          {drawMode === "draw" && (
            <div className="glass-surface absolute inset-x-3 bottom-3 z-10 flex flex-col gap-2 rounded-xl px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-2 text-xs leading-5 text-ink">
                <Pencil className="mt-0.5 h-4 w-4 shrink-0 text-action" />
                <span>{copy.instruction} <strong className="tnum">{drawPoints.length} {copy.points}</strong></span>
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={undoPoint} disabled={!drawPoints.length} className="inline-flex h-10 items-center gap-1.5 rounded-full border border-line bg-white px-3.5 text-xs font-semibold text-ink-soft transition hover:bg-soft active:scale-[0.98] disabled:opacity-40"><Undo2 className="h-3.5 w-3.5" />{copy.undo}</button>
                <button onClick={clearDrawing} className="inline-flex h-10 items-center gap-1.5 rounded-full border border-line bg-white px-3.5 text-xs font-semibold text-ink-soft transition hover:bg-soft active:scale-[0.98]"><Trash2 className="h-3.5 w-3.5" />{copy.clear}</button>
                <button onClick={finishDrawing} disabled={drawPoints.length < 3} className="inline-flex h-10 items-center gap-1.5 rounded-full bg-gradient-brand-deep px-3.5 text-xs font-semibold text-white shadow-float transition hover:opacity-95 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"><Check className="h-3.5 w-3.5" />{copy.finish}</button>
              </div>
            </div>
          )}

          {walkCorners.length > 0 && (
            <div className="glass-surface-dark pointer-events-none absolute bottom-[76px] left-1/2 z-[5] max-w-[92%] -translate-x-1/2 rounded-full px-4 py-2 text-center text-xs font-bold text-white">{copy.walkModePill}</div>
          )}

          {/* Compact field-information overlay (8.7). Hidden while the drawing
              bar occupies the bottom row. */}
          {drawMode !== "draw" && (
            <div className="glass-surface tnum absolute bottom-3 left-3 z-[5] hidden max-w-[calc(100%-200px)] items-center gap-2 rounded-full px-3 py-2.5 text-xs text-ink-soft sm:flex">
              <Compass className="h-4 w-4 shrink-0 text-action" />
              <span className="truncate">{copy.selectedLocation} <strong className="font-semibold text-brand-blue-deep">{locationName}</strong> · {selectedLat.toFixed(5)}°N, {selectedLon.toFixed(5)}°E{gpsAccuracy !== null ? ` · GPS ±${Math.round(gpsAccuracy)} m` : ""} · {copy.dragPin}</span>
            </div>
          )}

          {/* Map attribution stays visible and unobstructed (8.6); it rises
              above the drawing bar while that bar is open. */}
          <div className={`tnum absolute right-3 z-[5] max-w-[85%] rounded-full bg-white/92 px-3 py-2 text-[10px] font-semibold text-ink-muted ${drawMode === "draw" ? "bottom-[88px]" : "bottom-16"}`}>
            {mapStyle === "satellite" ? copy.attributionSatellite : copy.attributionStreets}
          </div>
        </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-divider bg-white px-4 py-3 text-[11px] text-ink-soft">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="inline-flex items-center gap-2"><span className="h-2.5 w-5 rounded-xs border border-[#64748B] bg-[#64748B]/15" /> {copy.districtBoundaries}</span>
                <span>{districts.length || 0} {districtLoading ? copy.districtsLoading : t.homeDistrictsAvailable}</span>
                {fieldArea !== null && <span className="tnum font-bold text-ink">{copy.area}: {fieldArea.toFixed(2)} ha</span>}
              </div>
            </div>
            {fieldArea !== null && <p className="border-t border-divider bg-white px-4 py-2 text-[11px] leading-4 text-ink-muted">{t.surveyAreaCaveat}</p>}
          </section>

          <SignalCoverageCard data={data} t={t} />
        </div>

        <div className="order-3 space-y-4">
          <StressCard data={data} onOpenField={onOpenField} t={t} />
          <RainImpactCard data={data} t={t} />
          <AskCard t={t} />
        </div>
      </div>

      {/* Walk method and stand survey — dense forms stay on solid, readable
          surfaces below the map (design.md: never glass-blur dense forms) */}
      <section className="rounded-2xl border border-line bg-white p-4 shadow-float sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-ink">
            <Footprints className="h-4 w-4 text-action" aria-hidden="true" />
            {copy.walkTitle}
          </h3>
          {walkStatus !== "idle" && (
            <span aria-live="polite" className={`tnum inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${walkStatus === "unavailable" ? "bg-danger-soft text-danger" : walkStatus === "waiting" ? "bg-amber-soft text-amber-ink" : "bg-success-soft text-success"}`}>
              {walkStatus === "unavailable"
                ? copy.walkUnavailable
                : walkStatus === "waiting"
                  ? copy.walkWaiting
                  : `GPS ±${Math.round(walkLiveAccuracy ?? 0)} m`}
            </span>
          )}
        </div>

        {/* GPS accuracy + privacy notice: informational blue (8.4) */}
        <div className="mt-2.5 flex items-start gap-2 rounded-lg border border-info/30 bg-info-soft px-3 py-2.5 text-xs leading-5 text-ink">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden="true" />
          <span>{copy.walkInfo} {copy.walkPrivacy}</span>
        </div>

        <div className="mt-3 rounded-lg border border-line bg-soft px-3.5 py-3 text-xs font-semibold text-ink-soft">
          {walkStatusBox}
        </div>

        <div className="mt-3 rounded-xl border border-line bg-soft p-3.5">
          <p className="text-sm font-bold text-ink">{t.surveyStandTitle}</p>
          <p className="mt-1 text-sm text-ink-soft">{t.surveyStandHelp}</p>
          <button ref={surveyTriggerRef} type="button" onClick={startStandSurvey} disabled={surveyCollecting} className="mt-3 inline-flex min-h-12 items-center gap-2 rounded-full bg-action px-5 text-sm font-bold text-white transition active:scale-[0.98] disabled:opacity-50">{surveyCollecting ? <Loader2 className="h-4 w-4 animate-spin"/> : <LocateFixed className="h-4 w-4"/>}{surveyCollecting ? `${t.surveyCollecting} ${surveyFixCount}/${FIELD_SURVEY_CONFIG.gpsFixCount}` : t.surveyStartCapture}</button>
          {surveyPoints.length>0 && <div className="mt-2 space-y-1 text-base text-ink-soft"><p className="font-semibold">{t.surveyOtherPoints}: {surveyPoints.length}</p>{surveyPoints.map((point)=><p key={point.id}>{({corner:copy.walkCorner,water:t.surveyWater,wet:t.surveyWet,erosion:t.surveyErosion,soil:t.surveySoil,note:t.surveyOther} as const)[point.type]} · {t.surveyPointQuality}: ±{Math.round(point.accuracy)} m</p>)}</div>}
          {gpsReceipt && <details className="mt-2 text-sm text-ink-soft"><summary className="min-h-12 cursor-pointer py-3 font-semibold">{t.surveyGpsReceipt}</summary><p>{t.surveyFixesUsed}: {gpsReceipt.used} · {t.surveyFixesRejected}: {gpsReceipt.rejected}</p></details>}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={markWalkCorner} disabled={walkRequesting} className="inline-flex h-10 items-center gap-2 rounded-full bg-action px-4 text-xs font-semibold text-white transition hover:bg-action-pressed active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60">
            {walkRequesting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <MapPin className="h-4 w-4" aria-hidden="true" />}
            {copy.walkMark}
          </button>
          <button onClick={undoWalkCorner} disabled={!walkCorners.length} className="inline-flex h-10 items-center gap-1.5 rounded-full border border-line bg-white px-3.5 text-xs font-semibold text-ink-soft transition hover:bg-soft active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40">
            <Undo2 className="h-4 w-4" aria-hidden="true" /> {copy.walkUndo}
          </button>
          <button onClick={clearWalkCorners} disabled={!walkCorners.length} className="inline-flex h-10 items-center gap-1.5 rounded-full border border-danger/30 bg-white px-3.5 text-xs font-semibold text-danger transition hover:bg-danger-soft active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40">
            <Trash2 className="h-4 w-4" aria-hidden="true" /> {copy.clear}
          </button>
          <button onClick={finishWalkField} disabled={walkCorners.length < 3} className="inline-flex h-10 items-center gap-1.5 rounded-full bg-action px-3.5 text-xs font-semibold text-white transition hover:bg-action-pressed active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40">
            <Check className="h-4 w-4" aria-hidden="true" /> {copy.walkFinish}
          </button>
        </div>

        {walkCorners.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {walkCorners.map((corner, index) => (
              <span
                key={`${index}-${corner.lat}-${corner.lon}`}
                className={`tnum inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-bold ${corner.accuracy > 15 ? "border-amber bg-amber-soft text-amber-ink" : "border-line bg-success-soft text-success"}`}
              >
                {copy.walkCorner} {index + 1} · ±{Math.round(corner.accuracy)} m
              </span>
            ))}
          </div>
        )}
      </section>
    </div>
    </>
  );
}
