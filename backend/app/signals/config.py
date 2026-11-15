import json
from functools import lru_cache
from pathlib import Path

from pydantic import BaseModel, Field


ASSUMPTION_NOTE = "Design assumption, pending review by a Nepali agronomist."


class SignalGates(BaseModel):
    """Tunable gates and classification cut-offs.

    Software completeness gates protect against reporting weak data. Agronomic
    cut-offs are design assumptions and are labelled as such wherever shown.
    """

    # Software freshness/completeness gates (not NASA quality flags).
    max_snapshot_age_days: int = Field(default=5, ge=1, le=30)
    # Composite products are published less often than daily products.
    source_max_age_days: dict[str, int] = Field(
        default_factory=lambda: {"smap": 3, "lst": 5, "vegetation": 25}
    )
    min_clear_sky_fraction: float = Field(default=0.5, ge=0, le=1)
    min_snapshot_coverage: float = Field(default=0.8, ge=0, le=1)
    anomaly_window_days: int = Field(default=7, ge=1, le=31)
    anomaly_min_years: int = Field(default=3, ge=2, le=30)

    # Percentile cut-offs for the versus-normal class. These describe the
    # position inside the local historical distribution; they are a software
    # classification assumption, not an agronomic threshold.
    much_below_percentile: float = Field(default=10.0, ge=0, le=50)
    below_percentile: float = Field(default=25.0, ge=0, le=50)
    above_percentile: float = Field(default=75.0, ge=50, le=100)
    much_above_percentile: float = Field(default=90.0, ge=50, le=100)

    # Agronomic assumptions, pending expert review. Values are deliberately
    # conservative screening aids, never application instructions.
    heat_day_max_c: float = Field(default=35.0)
    spray_max_wind_kmh: float = Field(default=15.0)
    spray_max_rain_probability: float = Field(default=40.0, ge=0, le=100)
    rain_heavy_24h_mm: float = Field(default=50.0, ge=0)
    rain_heavy_72h_mm: float = Field(default=80.0, ge=0)
    rain_heavy_forecast_mm: float = Field(default=10.0, ge=0)
    # Spread allowed between independent rainfall estimates on the same window
    # before they are called disagreeing. Software classification assumption.
    agreement_rain_abs_mm: float = Field(default=5.0, ge=0)
    agreement_rain_rel_fraction: float = Field(default=0.5, ge=0, le=1)

    @property
    def assumption_note(self) -> str:
        return ASSUMPTION_NOTE

    def max_age_days_for(self, source: str) -> int:
        return self.source_max_age_days.get(source, self.max_snapshot_age_days)


def _gates_path() -> Path:
    import os

    override = os.environ.get("SAFEFIELD_SIGNAL_GATES_PATH", "").strip()
    if override:
        return Path(override)
    return Path(__file__).resolve().parents[2] / "content" / "signal_gates.json"


@lru_cache
def get_gates() -> SignalGates:
    path = _gates_path()
    if not path.exists():
        return SignalGates()
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError(f"Signal gates file must contain a JSON object: {path}")
    return SignalGates.model_validate(raw)


def reset_gates_cache() -> None:
    get_gates.cache_clear()
