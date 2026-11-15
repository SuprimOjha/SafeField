/** Tunable field-survey quality settings; values are design assumptions pending local validation. */
export const FIELD_SURVEY_CONFIG = {
  gpsFixCount: 5,
  maxGpsAccuracyMeters: 15,
  maxPolygonVertices: 200,
} as const;
