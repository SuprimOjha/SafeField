"""Daily root-zone water balance (FAO-56 style, single crop coefficient).

All inputs come from the caller. This module contains NO crop, soil, or
weather data and no thresholds of its own: TAW, p, Kc and ET0 must come from
sourced content packs and data pipelines (see provenance rules).

Depletion Dr is how much water the root zone has lost below field capacity.
  Dr = 0   -> root zone full
  Dr = RAW -> stress starts (RAW = p * TAW)
  Dr = TAW -> no easily usable water left
Daily update with capillary rise ignored:
  Dr_i = clamp(Dr_{i-1} - rain_i - irrigation_i + ETc_i, 0, TAW)
"""
from dataclasses import dataclass
from typing import Optional, Sequence

MM_TO_LITRES_PER_HA = 10_000.0  # 1 mm over 1 ha = 10 m3 = 10,000 L (exact)


def etc_mm(kc: float, et0_mm: float) -> float:
    """Crop evapotranspiration, ETc = Kc * ET0 (single coefficient)."""
    if kc < 0 or et0_mm < 0:
        raise ValueError("kc and et0 must be non-negative")
    return kc * et0_mm


def taw_mm(awc_mm_per_m: float, root_depth_m: float) -> float:
    """Total available water in the root zone."""
    if awc_mm_per_m <= 0 or root_depth_m <= 0:
        raise ValueError("awc and root depth must be positive")
    return awc_mm_per_m * root_depth_m


def raw_mm(taw: float, p: float) -> float:
    if not 0 < p <= 1:
        raise ValueError("p must be in (0, 1]")
    return p * taw


@dataclass(frozen=True)
class DayResult:
    dr_mm: float            # depletion at end of day
    absorbed_mm: float      # rain + irrigation the root zone could hold
    excess_mm: float        # rain + irrigation beyond what it could hold (runoff or drainage)


def step(dr_prev: float, rain_mm: float, irrigation_mm: float, etc: float, taw: float) -> DayResult:
    if min(dr_prev, rain_mm, irrigation_mm, etc, taw) < 0:
        raise ValueError("inputs must be non-negative")
    water_in = rain_mm + irrigation_mm
    room = dr_prev + etc                    # how much water the root zone could take today
    absorbed = min(water_in, room)
    excess = water_in - absorbed
    dr = min(max(dr_prev - water_in + etc, 0.0), taw)
    return DayResult(dr_mm=dr, absorbed_mm=absorbed, excess_mm=excess)


def ks(dr: float, taw: float, raw: float) -> float:
    """Water stress coefficient: 1 when Dr <= RAW, falling to 0 at Dr = TAW."""
    if dr <= raw:
        return 1.0
    return max(0.0, min(1.0, (taw - dr) / (taw - raw)))


def days_until_trigger(
    dr_now: float,
    raw: float,
    taw: float,
    etc_forecast: Sequence[float],
    rain_forecast: Optional[Sequence[float]] = None,
) -> Optional[int]:
    """First forecast day (1-based) on which depletion reaches RAW, else None."""
    dr = dr_now
    for i, e in enumerate(etc_forecast):
        rain = rain_forecast[i] if rain_forecast is not None else 0.0
        dr = step(dr, rain, 0.0, e, taw).dr_mm
        if dr >= raw:
            return i + 1
    return None


def irrigation_volume_litres(net_depth_mm: float, area_ha: float) -> float:
    """Net volume for the field. Before application losses."""
    if net_depth_mm < 0 or area_ha < 0:
        raise ValueError("depth and area must be non-negative")
    return net_depth_mm * area_ha * MM_TO_LITRES_PER_HA
