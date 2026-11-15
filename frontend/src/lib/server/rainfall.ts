// Real rainfall observation provider for the "Local rainfall · past 72 hours"
// card. The Python backend requires a manually-installed GPM IMERG SQLite
// cache (Earthdata credentials + `fetch-imerg`), which is never present on
// serverless deployments, so the card permanently showed "Not verified" with
// only a coarse NASA POWER regional estimate beside it.
//
// This provider returns the freshest real daily precipitation available
// without credentials: Open-Meteo's reanalysis-backed `past_days` daily
// rain_sum (ERA5 / ECMWF best-match blend, ~9-11 km grid). It is real
// observed/reanalysis data with a true UTC observation window and honest
// provenance (kind="model"), never a synthetic or assumed number. When it
// cannot be retrieved, the observation stays UNAVAILABLE with an explanation
// plus the NASA POWER regional context — no value is substituted.

import type { RainfallObservation, RainfallProvenance, DailyWeatherRecord } from "@/types/safefield";

const OPEN_METEO_PAST_URL = "https://api.open-meteo.com/v1/forecast";

interface OpenMeteoPastResponse {
  daily?: { time?: string[]; rain_sum?: (number | null)[] };
}

function startOfUtcDay(dateIso: string): number {
  return Date.parse(`${dateIso}T00:00:00Z`);
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function getRecentRain(
  latitude: number,
  longitude: number,
  hours: number,
  powerRecords: DailyWeatherRecord[],
  power72h: number | null,
  powerResolution: string,
): Promise<RainfallObservation> {
  const requiredDays = Math.round(hours / 24);
  if (hours <= 0 || hours % 24 !== 0 || requiredDays < 1) {
    return {
      status: "UNAVAILABLE",
      amount_mm: null,
      window_hours: hours,
      provenance: null,
      unavailable_reason: "Daily reanalysis rainfall supports whole-day windows only.",
    };
  }

  const latR = Math.round(latitude * 100) / 100;
  const lonR = Math.round(longitude * 100) / 100;
  const powerContext = (() => {
    const dated = powerRecords.filter((record) => record.precip_mm !== null).slice(-requiredDays);
    if (power72h === null || dated.length !== requiredDays) return "";
    const dates = dated.map((record) => record.date).join(", ");
    return ` NASA POWER regional estimate: ${power72h} mm across available daily records ${dates} (${powerResolution}); this coarse reanalysis is not verification of rainfall at the selected field.`;
  })();

  try {
    const raw = await fetchWithTimeout<OpenMeteoPastResponse>(
      `${OPEN_METEO_PAST_URL}?latitude=${latR}&longitude=${lonR}&daily=rain_sum&past_days=${requiredDays + 2}&forecast_days=1&timezone=UTC`,
      12_000,
    );
    const time = raw.daily?.time ?? [];
    const rain = raw.daily?.rain_sum ?? [];
    if (time.length === 0 || time.length !== rain.length) {
      throw new Error("Open-Meteo past-days response incomplete");
    }

    // Only complete UTC days count. Today's row is a partial day and is never used.
    const todayUtc = isoDay(new Date());
    const completeDays: { date: string; mm: number | null }[] = [];
    for (let index = 0; index < time.length; index++) {
      const day = String(time[index]).slice(0, 10);
      if (day >= todayUtc) continue;
      const value = rain[index];
      completeDays.push({
        date: day,
        mm: value === null || value === undefined || !Number.isFinite(Number(value)) ? null : Number(value),
      });
    }
    completeDays.sort((a, b) => a.date.localeCompare(b.date));

    const selected = completeDays.slice(-requiredDays);
    if (selected.length !== requiredDays) {
      return unavailable(`The reanalysis archive returned only ${selected.length} complete past day(s); ${requiredDays} consecutive days are required.` + powerContext);
    }
    const oneDayMs = 24 * 60 * 60 * 1000;
    for (let index = 1; index < selected.length; index++) {
      if (startOfUtcDay(selected[index].date) - startOfUtcDay(selected[index - 1].date) !== oneDayMs) {
        return unavailable("The reanalysis daily records contain a date gap; no rolling total is reported." + powerContext);
      }
    }
    if (selected.some((day) => day.mm === null)) {
      return unavailable("The nearest reanalysis grid cell is missing one or more daily precipitation values." + powerContext);
    }
    const newestAgeDays = Math.floor((Date.now() - startOfUtcDay(selected[selected.length - 1].date)) / oneDayMs);
    if (newestAgeDays > 5) {
      return unavailable("The newest reanalysis day is more than five days old; no stale rainfall total is used." + powerContext);
    }

    const amount = Math.round(selected.reduce((acc, day) => acc + (day.mm as number), 0) * 100) / 100;
    const provenance: RainfallProvenance = {
      source_name: "Open-Meteo Reanalysis Daily Precipitation (non-NASA)",
      kind: "model",
      observed_start_utc: `${selected[0].date}T00:00:00Z`,
      observed_end_utc: `${isoDay(new Date(startOfUtcDay(selected[selected.length - 1].date) + oneDayMs))}T00:00:00Z`,
      fetched_at_utc: new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00"),
      spatial_resolution: "~9–11 km reanalysis grid; nearest grid cell to selected point",
      latency_note:
        "Reanalysis daily totals are produced from weather-model and gauge-blended data after each UTC day closes; the reported interval is the true observation window, typically 6–24 hours behind real time.",
      dataset: "ERA5 / ECMWF IFS best-match blend (via Open-Meteo)",
      version: "Open-Meteo v1 API",
      stream: null,
      granule_ids: [],
      units: "mm/day summed over complete UTC days",
      spatial_method: "nearest_grid_cell",
      coverage_fraction: null,
    };
    return { status: "AVAILABLE", amount_mm: amount, window_hours: hours, provenance, unavailable_reason: null };
  } catch (error) {
    return unavailable(
      `Reanalysis rainfall lookup failed (${String(error)}). No usable local-scale observation is available for the requested window.` +
        powerContext,
    );
  }
}

function unavailable(reason: string): RainfallObservation {
  return {
    status: "UNAVAILABLE",
    amount_mm: null,
    window_hours: 72,
    provenance: null,
    unavailable_reason: reason,
  };
}

async function fetchWithTimeout<T>(url: string, timeoutMs: number): Promise<T> {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}
