import json
import math
import os
from datetime import date, datetime
from pathlib import Path
from typing import Literal, TypeVar

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.signals.models import SignalName


class SnapshotFormatError(ValueError):
    """A snapshot exists but does not satisfy the published contract."""


class _Cell(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


class SmapCell(_Cell):
    surface_sm: float | None = Field(default=None, ge=0, le=1)
    root_sm: float | None = Field(default=None, ge=0, le=1)
    quality: Literal["good", "rejected", "missing"] = "good"


class SmapSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    product: str = Field(min_length=3)
    version: str = Field(min_length=1)
    data_date: date
    fetched_at: datetime
    resolution_km: float = Field(gt=0)
    grid_spacing_km: float | None = Field(default=None, gt=0)
    model_only: bool | None = None
    coverage_fraction: float | None = Field(default=None, ge=0, le=1)
    granule_ids: list[str] = Field(default_factory=list)
    cells: list[SmapCell] = Field(default_factory=list)


class LstCell(_Cell):
    lst_day_c: float | None = None
    lst_night_c: float | None = None
    qc_good: bool = False
    clear_sky: bool = False


class LstSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    product: str = Field(min_length=3)
    version: str = Field(min_length=1)
    data_date: date
    fetched_at: datetime
    resolution_km: float = Field(gt=0)
    grid_spacing_km: float | None = Field(default=None, gt=0)
    granule_ids: list[str] = Field(default_factory=list)
    cells: list[LstCell] = Field(default_factory=list)


class VegCell(_Cell):
    ndvi: float | None = Field(default=None, ge=-1, le=1)
    evi: float | None = Field(default=None, ge=-1, le=1)
    qa_good: bool = False


class VegSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    product: str = Field(min_length=3)
    version: str = Field(min_length=1)
    composite_start: date
    composite_end: date
    fetched_at: datetime
    resolution_m: float = Field(gt=0)
    grid_spacing_m: float | None = Field(default=None, gt=0)
    granule_ids: list[str] = Field(default_factory=list)
    cells: list[VegCell] = Field(default_factory=list)


SnapshotModel = TypeVar("SnapshotModel", bound=BaseModel)


def data_root() -> Path:
    override = os.environ.get("SAFEFIELD_SIGNAL_DATA_DIR", "").strip()
    if override:
        return Path(override)
    return Path(__file__).resolve().parents[2] / "data" / "signals"


def source_dir(source: str, root: Path | None = None) -> Path:
    return (root or data_root()) / source


def snapshot_dates(source: str, root: Path | None = None) -> list[date]:
    directory = source_dir(source, root)
    if not directory.exists():
        return []
    dates: list[date] = []
    for path in directory.glob("*.json"):
        try:
            dates.append(date.fromisoformat(path.stem))
        except ValueError:
            continue
    return sorted(dates)


def load_snapshot_on(
    source: str,
    model: type[SnapshotModel],
    day: date,
    root: Path | None = None,
) -> SnapshotModel | None:
    path = source_dir(source, root) / f"{day.isoformat()}.json"
    if not path.exists():
        return None
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SnapshotFormatError(f"{path.name}: {exc}") from exc
    try:
        return model.model_validate(raw)
    except ValidationError as exc:
        raise SnapshotFormatError(f"{path.name}: {exc}") from exc


def load_latest_snapshot(
    source: str,
    model: type[SnapshotModel],
    today: date,
    root: Path | None = None,
) -> tuple[Path, SnapshotModel] | None:
    """Load the newest snapshot whose file date is not in the future.

    A malformed newest snapshot raises instead of silently falling back to an
    older file, so a broken pipeline cannot masquerade as fresh data.
    """
    directory = source_dir(source, root)
    if not directory.exists():
        return None
    candidates: list[tuple[date, Path]] = []
    for path in directory.glob("*.json"):
        try:
            file_date = date.fromisoformat(path.stem)
        except ValueError:
            continue
        if file_date <= today:
            candidates.append((file_date, path))
    if not candidates:
        return None
    candidates.sort(key=lambda item: item[0], reverse=True)
    _, path = candidates[0]
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SnapshotFormatError(f"{path.name}: {exc}") from exc
    try:
        parsed = model.model_validate(raw)
    except ValidationError as exc:
        raise SnapshotFormatError(f"{path.name}: {exc}") from exc
    return path, parsed  # type: ignore[return-value]


def haversine_km(lat_a: float, lon_a: float, lat_b: float, lon_b: float) -> float:
    radius_km = 6371.0088
    phi_a, phi_b = math.radians(lat_a), math.radians(lat_b)
    delta_phi = math.radians(lat_b - lat_a)
    delta_lambda = math.radians(lon_b - lon_a)
    a = (
        math.sin(delta_phi / 2) ** 2
        + math.cos(phi_a) * math.cos(phi_b) * math.sin(delta_lambda / 2) ** 2
    )
    return 2 * radius_km * math.asin(min(1.0, math.sqrt(a)))


def nearest_cell(cells: list, latitude: float, longitude: float):
    if not cells:
        return None
    return min(
        cells,
        key=lambda cell: haversine_km(latitude, longitude, cell.latitude, cell.longitude),
    )


def valid_coverage(cells: list, valid: list[bool]) -> float:
    if not cells:
        return 0.0
    return sum(1 for item in valid if item) / len(cells)


def coverage_radius_km(
    resolution_km: float, grid_spacing_km: float | None = None
) -> float:
    """Radius used by ``within_coverage`` for one snapshot.

    ``within_coverage`` allows two of these radii. A snapshot built on a regular
    grid reports how far apart its cells are: half the spacing keeps the
    allowed distance at one grid step instead of two native pixels.
    """
    if grid_spacing_km:
        return grid_spacing_km / 2
    return resolution_km


def within_coverage(cell, latitude: float, longitude: float, resolution_km: float) -> bool:
    """Reject an edge-of-snapshot cell that does not actually cover the field.

    A snapshot may only contain a pilot region. Returning the nearest edge cell
    for a field outside that region would silently misreport a distant pixel as
    local, so the distance is capped at two source pixels (never below 2 km).
    """
    return haversine_km(latitude, longitude, cell.latitude, cell.longitude) <= max(
        2.0 * resolution_km, 2.0
    )


SIGNAL_SOURCES: dict[str, str] = {
    "soil_moisture_surface": "smap",
    "soil_moisture_root": "smap",
    "heat_surface": "lst",
    "ndvi": "vegetation",
    "evi": "vegetation",
}


def source_for_signal(name: SignalName) -> str | None:
    return SIGNAL_SOURCES.get(name)
