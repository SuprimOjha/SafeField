"use client";

import React, { useState, useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapPin, Navigation, Compass, ArrowRight } from "lucide-react";

interface ScreenAHomeProps {
  selectedLat: number;
  selectedLon: number;
  onLocationSelect: (lat: number, lon: number, name: string) => void;
  onProceedToField: () => void;
  lang: "en" | "ne";
}

const PILOT_LOCATIONS = [
  { nameEn: "Biratnagar (Morang - Terai Hub)", nameNe: "विराटनगर (मोरङ)", lat: 26.45, lon: 87.28 },
  { nameEn: "Itahari (Sunsari - Pilot)", nameNe: "इटहरी (सुनसरी)", lat: 26.66, lon: 87.27 },
  { nameEn: "Bhadrapur (Jhapa - Eastern Terai)", nameNe: "भद्रपुर (झापा)", lat: 26.54, lon: 88.09 },
  { nameEn: "Ilam Bazaar (Hills Pilot)", nameNe: "इलाम बजार (पहाडी क्षेत्र)", lat: 26.91, lon: 87.92 },
];

export default function ScreenAHome({
  selectedLat,
  selectedLon,
  onLocationSelect,
  onProceedToField,
  lang,
}: ScreenAHomeProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);

  const [locationName, setLocationName] = useState("Biratnagar, Morang");
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapProvider, setMapProvider] = useState<"carto" | "osm">("carto");

  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapRef.current) {
      mapRef.current = new maplibregl.Map({
        container: mapContainerRef.current,
        // Use a raster basemap to avoid vector-style glyph/sprite and tile failures.
        // CARTO Voyager is keyless and includes OSM street/place labels.
        style: {
          version: 8,
          sources: {
            "carto-voyager": {
              type: "raster",
              tiles: ["https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png"],
              tileSize: 256,
              attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/attributions">CARTO</a>',
            },
          },
          layers: [{ id: "carto-voyager", type: "raster", source: "carto-voyager" }],
        },
        center: [selectedLon, selectedLat],
        zoom: 9,
        attributionControl: true,
        cooperativeGestures: true,
      });

      mapRef.current.addControl(new maplibregl.NavigationControl({ showCompass: true }), "top-right");
      mapRef.current.on("load", () => setMapError(null));
      mapRef.current.on("error", (event) => {
        console.error("MapLibre basemap/tile error:", event.error);
        setMapError("Map tiles are not responding. Check that basemaps.cartocdn.com is reachable on your network.");
      });

      markerRef.current = new maplibregl.Marker({ color: "#2e6930" })
        .setLngLat([selectedLon, selectedLat])
        .addTo(mapRef.current);

      mapRef.current.on("click", (e: maplibregl.MapMouseEvent) => {
        const { lng, lat } = e.lngLat;
        if (lat >= 26.3 && lat <= 30.5 && lng >= 80.0 && lng <= 88.3) {
          onLocationSelect(lat, lng, `Custom Point (${lat.toFixed(2)}°N, ${lng.toFixed(2)}°E)`);
          setLocationName(`Custom Point (${lat.toFixed(2)}°N, ${lng.toFixed(2)}°E)`);
          if (markerRef.current) {
            markerRef.current.setLngLat([lng, lat]);
          }
        }
      });
    }

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (markerRef.current && mapRef.current) {
      markerRef.current.setLngLat([selectedLon, selectedLat]);
      mapRef.current.flyTo({ center: [selectedLon, selectedLat], zoom: 10 });
    }
  }, [selectedLat, selectedLon]);

  const handleSelectPreset = (loc: typeof PILOT_LOCATIONS[0]) => {
    onLocationSelect(loc.lat, loc.lon, lang === "ne" ? loc.nameNe : loc.nameEn);
    setLocationName(lang === "ne" ? loc.nameNe : loc.nameEn);
  };

  const handleUseGps = () => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const lat = position.coords.latitude;
          const lon = position.coords.longitude;
          if (lat >= 26.3 && lat <= 30.5 && lon >= 80.0 && lon <= 88.3) {
            onLocationSelect(lat, lon, "My Current GPS Field");
            setLocationName("My Current GPS Field");
          } else {
            alert(lang === "ne" ? "तपाईंको GPS स्थान नेपाल बाहिर छ।" : "Your GPS location is outside Nepal pilot bounds.");
          }
        },
        () => {
          alert(lang === "ne" ? "GPS लिन सकिएन।" : "Unable to retrieve your GPS location.");
        }
      );
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-emerald-100">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-4">
          <div>
            <h2 className="text-2xl font-bold text-emerald-900">
              {lang === "ne" ? "१. खेत वा स्थान छान्नुहोस्" : "1. Select Your Field Location"}
            </h2>
            <p className="text-gray-600 text-sm mt-1">
              {lang === "ne"
                ? "नक्सामा क्लिक गर्नुहोस् वा तलबाट पाइलट जिल्ला छान्नुहोस्।"
                : "Tap anywhere on the map of Nepal or pick a pilot district below."}
            </p>
          </div>
          <button
            onClick={handleUseGps}
            className="flex items-center gap-2 bg-emerald-800 hover:bg-emerald-900 text-white px-5 py-3 rounded-xl font-semibold shadow-sm transition"
          >
            <Navigation className="w-5 h-5" />
            {lang === "ne" ? "मेरो हालको स्थान (GPS)" : "Use My GPS Location"}
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          {PILOT_LOCATIONS.map((loc) => {
            const isSelected = Math.abs(selectedLat - loc.lat) < 0.05 && Math.abs(selectedLon - loc.lon) < 0.05;
            return (
              <button
                key={loc.nameEn}
                onClick={() => handleSelectPreset(loc)}
                className={`p-4 rounded-xl border text-left transition flex flex-col justify-between ${
                  isSelected
                    ? "border-emerald-600 bg-emerald-50 ring-2 ring-emerald-600/20"
                    : "border-gray-200 bg-gray-50/50 hover:bg-white hover:border-emerald-300"
                }`}
              >
                <div className="flex items-center gap-2 text-emerald-800 font-semibold mb-1">
                  <MapPin className="w-4 h-4 shrink-0" />
                  <span className="text-sm">{lang === "ne" ? loc.nameNe : loc.nameEn}</span>
                </div>
                <span className="text-xs text-gray-500 font-mono">
                  {loc.lat}°N, {loc.lon}°E
                </span>
              </button>
            );
          })}
        </div>

        <div className="relative w-full h-[400px] rounded-xl overflow-hidden border border-gray-200 shadow-inner">
          <div ref={mapContainerRef} className="w-full h-full" />
          {mapError && (
            <div role="alert" className="absolute top-3 left-3 right-3 z-10 rounded-lg border border-amber-300 bg-amber-50/95 px-3 py-2 text-xs font-medium text-amber-950 shadow-sm">
              {mapError}
              <button
                type="button"
                onClick={() => {
                  setMapError(null);
                  mapRef.current?.setStyle({
                    version: 8,
                    sources: {
                      "osm-standard": {
                        type: "raster",
                        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
                        tileSize: 256,
                        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
                      },
                    },
                    layers: [{ id: "osm-standard", type: "raster", source: "osm-standard" }],
                  });
                }}
                className="ml-3 underline font-bold"
              >
                Try OpenStreetMap tiles
              </button>
            </div>
          )}
          <div className="absolute bottom-3 left-3 bg-white/90 backdrop-blur-sm px-4 py-2 rounded-lg shadow border border-gray-200 text-xs text-gray-700 font-medium flex items-center gap-2">
            <Compass className="w-4 h-4 text-emerald-700 animate-spin" />
            <span>Selected: <strong className="text-emerald-900">{locationName}</strong> ({selectedLat.toFixed(2)}°N, {selectedLon.toFixed(2)}°E)</span>
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            onClick={onProceedToField}
            className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white px-8 py-4 rounded-xl font-bold text-lg shadow-md transition"
          >
            {lang === "ne" ? "माटो र बाली विवरण प्रविष्ट गर्नुहोस्" : "Next: Enter Soil & Crop Details"}
            <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}