export interface GpsFix {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp?: number;
}

export interface AverageFixesOptions {
  maxAccuracyMeters?: number;
}

export interface AverageFixesResult {
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  usedCount: number;
  rejectedCount: number;
}

/** Average only finite, positive-accuracy fixes within the configured quality gate. */
export function averageFixes(
  fixes: readonly GpsFix[],
  options: AverageFixesOptions = {},
): AverageFixesResult {
  const maxAccuracy = options.maxAccuracyMeters ?? 15;
  const valid = fixes.filter((fix) =>
    Number.isFinite(fix.latitude) &&
    Number.isFinite(fix.longitude) &&
    Number.isFinite(fix.accuracy) &&
    fix.accuracy > 0 &&
    fix.accuracy <= maxAccuracy &&
    fix.latitude >= -90 && fix.latitude <= 90 &&
    fix.longitude >= -180 && fix.longitude <= 180
  );
  if (valid.length === 0) {
    return { latitude: null, longitude: null, accuracy: null, usedCount: 0, rejectedCount: fixes.length };
  }
  return {
    latitude: valid.reduce((sum, fix) => sum + fix.latitude, 0) / valid.length,
    longitude: valid.reduce((sum, fix) => sum + fix.longitude, 0) / valid.length,
    accuracy: valid.reduce((sum, fix) => sum + fix.accuracy, 0) / valid.length,
    usedCount: valid.length,
    rejectedCount: fixes.length - valid.length,
  };
}
