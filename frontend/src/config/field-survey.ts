/** Tunable field-survey quality settings; values are design assumptions pending local validation. */
export const FIELD_SURVEY_CONFIG = {
  gpsFixCount: 5,
  minGoodGpsFixes: 3,
  maxGpsAccuracyMeters: 15,
  // Initial product quality bands; validate against local device testing before agronomic use.
  madK: 3,
  madFloorM: 2,
  goodM: 5,
  fairM: 15,
  maxPolygonVertices: 200,
} as const;
