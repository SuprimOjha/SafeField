# Basemap provider notes

## Street basemap
The default street basemap is OpenFreeMap's Bright style, rendered by MapLibre GL JS:
`https://tiles.openfreemap.org/styles/bright`

OpenFreeMap states its public instance is free, with no API key, registration, or map-view/request limit. Attribution is required; MapLibre adds the style attribution automatically. The application also shows a visible map credit.

- [OpenFreeMap service and attribution](https://openfreemap.org/)
- [OpenFreeMap terms](https://openfreemap.org/tos/)
- [OpenFreeMap quick start](https://openfreemap.org/quick_start/)

OpenFreeMap is an "as-is" service and may change or discontinue. Keep the district picker and GPS controls available if the tile service is temporarily unavailable. Do not use OpenStreetMap's standard raster tile servers as an improvised production fallback.

## Optional satellite imagery
The optional overlay uses Esri World Imagery:
`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}`

- It is hidden by default and layered below map labels.
- The app caps imagery display at zoom 18; this is a conservative client display cap, not a guarantee of imagery resolution or coverage.
- If Esri tiles fail, the app returns to the OpenFreeMap street map and disables the satellite toggle for that session.
- Imagery can be blurry, old, or unavailable in rural areas. A successful tile response does not guarantee useful plot-level imagery.
- Keep Esri and imagery-provider attribution visible: "Sources: Esri, Maxar, Earthstar Geographics, and the GIS User Community."

**Licensing caveat:** do not assume keyless tile access is a blanket commercial or unlimited-use grant. Esri's service terms distinguish noncommercial and commercial use, allow service changes/discontinuation, and require attribution. Check the current [Esri service terms](https://www.esri.com/en-us/legal/terms/web-site-service) and applicable third-party imagery terms before public or commercial deployment. Seek written clarification from Esri if the intended deployment or usage volume is uncertain.

## Farmer selection flow
1. Select a named district from the local Nepal district list.
2. Use GPS (requires HTTPS or localhost and permission).
3. Tap once on the map to drop a pin and run the location assessment.
4. Optionally draw a polygon to estimate area and refine the representative field location.

A drawn polygon does not make source datasets field-resolution. The current field assessment queries a selected point/field centre. NASA POWER rainfall is a coarse gridded reanalysis product (roughly 0.5° × 0.625°, around 55 km at Nepal latitudes). GPM IMERG is not yet integrated into this assessment. Do not claim a 10 km satellite rainfall estimate for the current decision.

Before release, test street tiles, satellite coverage, attribution, GPS and polygon drawing on real Android phones and representative rural Nepal locations.
