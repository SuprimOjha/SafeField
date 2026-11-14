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
  type GoogleLatLng = { lat(): number; lng(): number };
  type GoogleMapInstance = {
    setCenter(position: { lat: number; lng: number }): void;
    setZoom(zoom: number): void;
    addListener(eventName: string, handler: (event: { latLng?: GoogleLatLng }) => void): void;
  };
  type GoogleMarkerInstance = {
    setPosition(position: { lat: number; lng: number }): void;
  };
  type GoogleMapsNamespace = {
    maps: {
      Map: new (element: HTMLElement, options: Record<string, unknown>) => GoogleMapInstance;
      Marker: new (options: Record<string, unknown>) => GoogleMarkerInstance;
      MapTypeId: { ROADMAP: string; SATELLITE: string; TERRAIN: string };
    };
  };
  const mapRef = useRef<GoogleMapInstance | null>(null);
  const markerRef = useRef<GoogleMarkerInstance | null>(null);
  const googleRef = useRef<GoogleMapsNamespace | null>(null);

  const [locationName, setLocationName] = useState("Biratnagar, Morang");
  const [mapError, setMapError] = useState<string | null>(null);

  useEffect(() => {
    if (!mapContainerRef.current) return;

    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      setMapError("Google Maps API key is missing. Add NEXT_PUBLIC_GOOGLE_MAPS_API_KEY to frontend/.env.local and restart the dev server.");
      return;
    }

    const initializeMap = () => {
      const googleMaps = (window as Window & { google?: GoogleMapsNamespace }).google;
      if (!googleMaps || !mapContainerRef.current) {
        setMapError("Google Maps could not initialize. Check that Maps JavaScript API is enabled for this key.");
        return;
      }

      googleRef.current = googleMaps;
      const map = new googleMaps.maps.Map(mapContainerRef.current, {
        center: { lat: selectedLat, lng: selectedLon },
        zoom: 9,
        mapTypeId: googleMaps.maps.MapTypeId.ROADMAP,
        mapTypeControl: true,
        mapTypeControlOptions: {
          mapTypeIds: [
            googleMaps.maps.MapTypeId.ROADMAP,
            googleMaps.maps.MapTypeId.SATELLITE,
            googleMaps.maps.MapTypeId.TERRAIN,
          ],
        },
        streetViewControl: false,
        fullscreenControl: true,
        clickableIcons: false,
      });
      mapRef.current = map;

      markerRef.current = new googleMaps.maps.Marker({
        map,
        position: { lat: selectedLat, lng: selectedLon },
        title: "Selected farm location",
        animation: null,
      });

      map.addListener("click", (event) => {
        if (!event.latLng) return;
        const lat = event.latLng.lat();
        const lon = event.latLng.lng();
        if (lat >= 26.3 && lat <= 30.5 && lon >= 80.0 && lon <= 88.3) {
          onLocationSelect(lat, lon, `Custom Point (${lat.toFixed(2)}°N, ${lon.toFixed(2)}°E)`);
          setLocationName(`Custom Point (${lat.toFixed(2)}°N, ${lon.toFixed(2)}°E)`);
          markerRef.current?.setPosition({ lat, lng: lon });
        }
      });
      setMapError(null);
    };

    const existingScript = document.getElementById("google-maps-javascript-api") as HTMLScriptElement | null;
    if ((window as Window & { google?: GoogleMapsNamespace }).google) {
      initializeMap();
    } else if (existingScript) {
      existingScript.addEventListener("load", initializeMap, { once: true });
      existingScript.addEventListener("error", () => setMapError("Google Maps failed to load. Check your network and API key."), { once: true });
    } else {
      const script = document.createElement("script");
      script.id = "google-maps-javascript-api";
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly`;
      script.async = true;
      script.defer = true;
      script.onload = initializeMap;
      script.onerror = () => setMapError("Google Maps failed to load. Check your API key, billing, enabled API and network.");
      document.head.appendChild(script);
    }

    return () => {
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (markerRef.current && mapRef.current) {
      markerRef.current.setPosition({ lat: selectedLat, lng: selectedLon });
      mapRef.current.setCenter({ lat: selectedLat, lng: selectedLon });
      mapRef.current.setZoom(10);
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