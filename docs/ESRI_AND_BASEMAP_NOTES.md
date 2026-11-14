# Basemap provider notes

The field map uses OpenFreeMap for the street-map style and Esri World Imagery as an optional imagery overlay.

- Keep attribution visible in the map UI.
- Keep OpenFreeMap street style as the default and a working fallback when imagery tiles fail.
- Do not describe Esri imagery as unrestricted or universally free for every deployment.
- Review current Esri World Imagery terms, attribution requirements, caching and redistribution restrictions before public/production use.
- Verify the current OpenFreeMap service terms and style URL before release.
- Test both layers on mobile networks and with browser developer tools.
