"""Read the latest NASA land products into the installed snapshot contracts.

Three products feed the field signals:

* SMAP L4 ``SPL4SMGP`` v008 (HDF5 ``Geophysical_Data/sm_surface`` and
  ``sm_rootzone``), averaged over the eight 3-hourly granules of one UTC day.
* VIIRS ``VNP21A1D`` v002 daytime land surface temperature, aggregated from
  native 1 km sinusoidal pixels to a 0.1 degree grid over Nepal.
* VIIRS ``VNP13A1`` v002 NDVI/EVI 16-day composite, aggregated the same way
  from native 500 m pixels.

Values are read from the published files and only quality-approved pixels are
averaged. A missing granule, missing field or empty result raises instead of
producing a partial or invented value. Earthdata authentication is required;
no credentials or absolute paths are written to the staged snapshot.
"""

from __future__ import annotations

import json
import os
import re
import tempfile
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Literal

import numpy as np

from app.ingest.raw import incoming_dir
from app.ingest.shared import latest_snapshot_date
from app.signals.snapshots import LstSnapshot, SmapSnapshot, VegSnapshot

NEPAL_BBOX = (80.0, 26.3, 88.3, 30.5)
GRID_STEP_DEGREES = 0.1
GRID_ROWS = 42
GRID_COLS = 83
GRID_MIN_LAT = 26.3
GRID_MIN_LON = 80.0
GRID_SAMPLE_COUNT = GRID_ROWS * GRID_COLS
GRID_SPACING_KM = 11.1
GRID_SPACING_M = 11100.0

SMAP_HOURS = frozenset(range(0, 24, 3))
SINUSOIDAL_TILE = re.compile(r"\.h(\d{2})v(\d{2})\.")
# MODIS/VIIRS sinusoidal tile geometry (sphere radius used by the products).
SINUSOIDAL_RADIUS_M = 6371007.181
SINUSOIDAL_ORIGIN_X = -20015109.354
SINUSOIDAL_ORIGIN_Y = 10007554.677
SINUSOIDAL_TILE_M = 1111950.519667


@dataclass(frozen=True)
class ProductSpec:
    source: str
    short_name: str
    version: str
    lookback_days: int
    label: str


PRODUCTS: dict[str, ProductSpec] = {
    "smap": ProductSpec(
        source="smap",
        short_name="SPL4SMGP",
        version="008",
        lookback_days=10,
        label="SMAP L4 surface and root zone soil moisture",
    ),
    "lst": ProductSpec(
        source="lst",
        short_name="VNP21A1D",
        version="002",
        # VNP21A1D publishes with multi-day latency; a 6-day window silently
        # finds nothing, so look back far enough to cover a delayed period.
        lookback_days=30,
        label="VIIRS daytime land surface temperature",
    ),
    "vegetation": ProductSpec(
        source="vegetation",
        short_name="VNP13A1",
        version="002",
        lookback_days=45,
        label="VIIRS 16-day NDVI/EVI composite",
    ),
}


@dataclass(frozen=True)
class GranuleRef:
    granule_id: str
    begin: datetime
    end: datetime
    handle: Any = None


@dataclass(frozen=True)
class Availability:
    day: date | None
    granules: list[GranuleRef]
    begin: date | None = None
    end: date | None = None
    reason: str | None = None


@dataclass
class ProductResult:
    source: str
    status: Literal["staged", "up_to_date", "not_available", "error"]
    day: date | None = None
    granule_ids: list[str] = field(default_factory=list)
    error: str | None = None


def _parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _as_ref(granule: Any) -> GranuleRef | None:
    umm = getattr(granule, "umm", None)
    if umm is None:
        umm = granule.get("umm", {}) if hasattr(granule, "get") else {}
    if not isinstance(umm, dict):
        return None
    granule_id = umm.get("GranuleUR") or umm.get("ProducerGranuleId")
    temporal = (umm.get("TemporalExtent") or {}).get("RangeDateTime") or {}
    begin = _parse_datetime(temporal.get("BeginningDateTime"))
    end = _parse_datetime(temporal.get("EndingDateTime"))
    if not granule_id or begin is None or end is None:
        return None
    return GranuleRef(granule_id=str(granule_id), begin=begin, end=end, handle=granule)


def search_granules(
    source: str,
    today: date,
    *,
    search_fn: Callable[[ProductSpec, date, date], list[Any]] | None = None,
) -> list[GranuleRef]:
    spec = PRODUCTS[source]
    start = today - timedelta(days=spec.lookback_days)
    if search_fn is None:
        import earthaccess

        results = earthaccess.search_data(
            short_name=spec.short_name,
            version=spec.version,
            temporal=(
                f"{start.isoformat()}T00:00:00Z",
                f"{today.isoformat()}T23:59:59Z",
            ),
            bounding_box=NEPAL_BBOX,
            count=2000,
        )
    else:
        results = search_fn(spec, start, today)
    return [ref for ref in (_as_ref(item) for item in results) if ref is not None]


def smap_availability(refs: list[GranuleRef], today: date) -> Availability:
    """Newest completed UTC day with all eight 3-hourly granules.

    The hour comes from the CMR temporal extent, not the file name: SPL4SMGP
    granule IDs are stamped at :30 past the hour while their windows begin on
    the 3-hour boundary.
    """
    by_day: dict[date, dict[int, GranuleRef]] = {}
    for ref in refs:
        day = ref.begin.date()
        hour = ref.begin.hour
        if day >= today or hour not in SMAP_HOURS:
            continue
        by_day.setdefault(day, {}).setdefault(hour, ref)
    for day in sorted(by_day, reverse=True):
        hours = by_day[day]
        if set(hours) == SMAP_HOURS:
            return Availability(day=day, granules=[hours[hour] for hour in sorted(hours)])
    return Availability(
        day=None,
        granules=[],
        reason=(
            "No completed SPL4SMGP day with all eight 3-hourly granules was published "
            f"in the last {PRODUCTS['smap'].lookback_days} days."
        ),
    )


def daily_availability(refs: list[GranuleRef], today: date) -> Availability:
    """Newest day with at least one published granule."""
    by_day: dict[date, list[GranuleRef]] = {}
    for ref in refs:
        day = ref.begin.date()
        if day >= today:
            continue
        by_day.setdefault(day, []).append(ref)
    if not by_day:
        return Availability(
            day=None,
            granules=[],
            reason=(
                f"No VNP21A1D granule covering Nepal was published in the last "
                f"{PRODUCTS['lst'].lookback_days} days."
            ),
        )
    day = max(by_day)
    return Availability(day=day, granules=sorted(by_day[day], key=lambda ref: ref.granule_id))


def vegetation_availability(refs: list[GranuleRef], today: date) -> Availability:
    """Newest published 16-day composite period."""
    by_period: dict[tuple[date, date], list[GranuleRef]] = {}
    for ref in refs:
        end = ref.end.date()
        if end > today:
            continue
        by_period.setdefault((ref.begin.date(), end), []).append(ref)
    if not by_period:
        return Availability(
            day=None,
            granules=[],
            reason=(
                f"No VNP13A1 composite covering Nepal was published in the last "
                f"{PRODUCTS['vegetation'].lookback_days} days."
            ),
        )
    (begin, end), granules = max(by_period.items(), key=lambda item: item[0][1])
    return Availability(
        day=end,
        begin=begin,
        end=end,
        granules=sorted(granules, key=lambda ref: ref.granule_id),
    )


def availability_for(source: str, refs: list[GranuleRef], today: date) -> Availability:
    if source == "smap":
        return smap_availability(refs, today)
    if source == "lst":
        return daily_availability(refs, today)
    if source == "vegetation":
        return vegetation_availability(refs, today)
    raise ValueError(f"Unknown product source '{source}'")


def _find_dataset(handle: Any, basename: str, *, near: str | None = None) -> Any:
    import h5py

    direct = handle.get(basename)
    if isinstance(direct, h5py.Dataset):
        return direct
    matches: list[str] = []

    def visit(name: str, obj: Any) -> None:
        if isinstance(obj, h5py.Dataset) and name.rsplit("/", 1)[-1] == basename:
            matches.append(name)

    handle.visititems(visit)
    if near:
        preferred = [name for name in matches if near in name]
        if preferred:
            matches = preferred
    if len(matches) != 1:
        raise RuntimeError(
            f"Expected exactly one HDF5 dataset named '{basename}'"
            + (f" near '{near}'" if near else "")
            + f"; found {matches or 'none'}."
        )
    return handle[matches[0]]


def _axis(handle: Any, basename: str, axis: int) -> np.ndarray:
    """Read one coordinate axis, whether it is stored 1-D or as a full grid."""
    dataset = _find_dataset(handle, basename)
    if dataset.ndim == 1:
        return np.asarray(dataset[()], dtype=float)
    return np.asarray(dataset[:, 0] if axis == 0 else dataset[0, :], dtype=float)


def _scaled(dataset: Any) -> tuple[np.ndarray, np.ndarray, float]:
    raw = np.asarray(dataset[()], dtype=float)
    attributes = dataset.attrs
    scale = float(attributes.get("scale_factor", 1.0))
    offset = float(attributes.get("offset", attributes.get("add_offset", 0.0)))
    fill = attributes.get("_FillValue", attributes.get("fill_value"))
    finite = np.isfinite(raw)
    if fill is not None:
        finite &= raw != float(fill)
    return raw * scale + offset, finite, scale


def _grid_centers() -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    latitudes = GRID_MIN_LAT + np.arange(GRID_ROWS) * GRID_STEP_DEGREES + GRID_STEP_DEGREES / 2
    longitudes = GRID_MIN_LON + np.arange(GRID_COLS) * GRID_STEP_DEGREES + GRID_STEP_DEGREES / 2
    return latitudes, longitudes, latitudes, longitudes


def _grid_accumulators() -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    return (
        np.zeros(GRID_SAMPLE_COUNT, dtype=float),
        np.zeros(GRID_SAMPLE_COUNT, dtype=float),
        np.zeros(GRID_SAMPLE_COUNT, dtype=float),
    )


def _bin_tile(
    tile_h: int,
    tile_v: int,
    values: np.ndarray,
    valid: np.ndarray,
    sums: np.ndarray,
    counts: np.ndarray,
    totals: np.ndarray,
) -> None:
    """Aggregate native sinusoidal pixels into the Nepal 0.1 degree grid."""
    rows, cols = values.shape
    pixel = SINUSOIDAL_TILE_M / rows
    x = SINUSOIDAL_ORIGIN_X + tile_h * SINUSOIDAL_TILE_M + (np.arange(cols) + 0.5) * pixel
    for start in range(0, rows, 256):
        stop = min(start + 256, rows)
        y = SINUSOIDAL_ORIGIN_Y - tile_v * SINUSOIDAL_TILE_M - (np.arange(start, stop) + 0.5) * pixel
        latitude = np.degrees(y / SINUSOIDAL_RADIUS_M)
        longitude = np.degrees(
            x[None, :] / (SINUSOIDAL_RADIUS_M * np.cos(np.radians(latitude))[:, None])
        )
        row_index = np.floor((latitude - GRID_MIN_LAT) / GRID_STEP_DEGREES).astype(int)
        col_index = np.floor((longitude - GRID_MIN_LON) / GRID_STEP_DEGREES).astype(int)
        inside = (
            (row_index[:, None] >= 0)
            & (row_index[:, None] < GRID_ROWS)
            & (col_index >= 0)
            & (col_index < GRID_COLS)
        )
        flat = row_index[:, None] * GRID_COLS + col_index
        totals += np.bincount(flat[inside], minlength=GRID_SAMPLE_COUNT)
        block_valid = valid[start:stop] & inside
        if block_valid.any():
            counts += np.bincount(flat[block_valid], minlength=GRID_SAMPLE_COUNT)
            sums += np.bincount(
                flat[block_valid],
                weights=values[start:stop][block_valid],
                minlength=GRID_SAMPLE_COUNT,
            )


def _tile_from_granule(granule_id: str) -> tuple[int, int]:
    match = SINUSOIDAL_TILE.search(granule_id)
    if not match:
        raise RuntimeError(f"Granule name '{granule_id}' does not contain a sinusoidal tile id.")
    return int(match.group(1)), int(match.group(2))


def read_smap(
    entries: list[tuple[str, Any, Any]],
    day: date,
    fetched_at: datetime,
) -> dict[str, Any]:
    """Average the eight 3-hourly SPL4SMGP granule windows for one UTC day."""
    import h5py

    if not entries:
        raise RuntimeError("No SPL4SMGP granules were supplied for the daily mean.")
    granule_ids = [granule_id for granule_id, _, _ in entries]

    block_lat: np.ndarray | None = None
    block_lon: np.ndarray | None = None
    surface_sum: np.ndarray | None = None
    surface_count: np.ndarray | None = None
    root_sum: np.ndarray | None = None
    root_count: np.ndarray | None = None
    r0 = r1 = c0 = c1 = 0

    for granule_id, handle, _ in entries:
        with h5py.File(handle, "r") as dataset:
            if block_lat is None:
                lat_axis = _axis(dataset, "cell_lat", 0)
                lon_axis = _axis(dataset, "cell_lon", 1)
                row_hits = np.flatnonzero(
                    (lat_axis >= NEPAL_BBOX[1]) & (lat_axis <= NEPAL_BBOX[3])
                )
                col_hits = np.flatnonzero(
                    (lon_axis >= NEPAL_BBOX[0]) & (lon_axis <= NEPAL_BBOX[2])
                )
                if not row_hits.size or not col_hits.size:
                    raise RuntimeError(
                        "The SPL4SMGP grid has no cells inside the Nepal bounding box."
                    )
                r0, r1 = int(row_hits[0]), int(row_hits[-1]) + 1
                c0, c1 = int(col_hits[0]), int(col_hits[-1]) + 1
                shape = (r1 - r0, c1 - c0)
                block_lat = np.broadcast_to(lat_axis[r0:r1][:, None], shape)
                block_lon = np.broadcast_to(lon_axis[c0:c1][None, :], shape)
                surface_sum = np.zeros(shape, dtype=float)
                surface_count = np.zeros(shape, dtype=float)
                root_sum = np.zeros(shape, dtype=float)
                root_count = np.zeros(shape, dtype=float)
            group = dataset.get("Geophysical_Data")
            if group is None:
                raise RuntimeError(
                    f"{granule_id} does not contain the expected Geophysical_Data group."
                )
            assert surface_sum is not None and surface_count is not None
            assert root_sum is not None and root_count is not None
            for field_name, total, count in (
                ("sm_surface", surface_sum, surface_count),
                ("sm_rootzone", root_sum, root_count),
            ):
                dataset_field = group.get(field_name)
                if dataset_field is None:
                    raise RuntimeError(
                        f"{granule_id} does not contain Geophysical_Data/{field_name}."
                    )
                raw = np.asarray(dataset_field[r0:r1, c0:c1], dtype=float)
                fill = dataset_field.attrs.get("_FillValue")
                valid = np.isfinite(raw) & (raw >= 0.0) & (raw <= 0.9)
                if fill is not None:
                    valid &= raw != float(fill)
                total[valid] += raw[valid]
                count[valid] += 1.0

    assert block_lat is not None and block_lon is not None
    assert surface_sum is not None and surface_count is not None
    assert root_sum is not None and root_count is not None
    shape = surface_sum.shape
    cells: list[dict[str, Any]] = []
    valid_cells = 0
    for row in range(shape[0]):
        for col in range(shape[1]):
            latitude = float(block_lat[row, col])
            longitude = float(block_lon[row, col])
            surface = (
                surface_sum[row, col] / surface_count[row, col]
                if surface_count[row, col] > 0
                else None
            )
            root = root_sum[row, col] / root_count[row, col] if root_count[row, col] > 0 else None
            if surface is None and root is None:
                quality = "missing"
            else:
                quality = "good"
                valid_cells += 1
            cells.append(
                {
                    "latitude": round(latitude, 5),
                    "longitude": round(longitude, 5),
                    "surface_sm": round(surface, 4) if surface is not None else None,
                    "root_sm": round(root, 4) if root is not None else None,
                    "quality": quality,
                }
            )

    return SmapSnapshot(
        product=PRODUCTS["smap"].short_name,
        version=PRODUCTS["smap"].version,
        data_date=day,
        fetched_at=fetched_at,
        resolution_km=9.0,
        grid_spacing_km=9.0,
        model_only=None,
        coverage_fraction=round(valid_cells / len(cells), 4) if cells else 0.0,
        granule_ids=granule_ids,
        cells=cells,
    ).model_dump(mode="json")


def _grid_cells(
    sums: np.ndarray,
    counts: np.ndarray,
    totals: np.ndarray,
) -> tuple[list[float | None], list[bool]]:
    """Average each grid cell, keeping only cells with at least half good pixels."""
    value_rows: list[float | None] = []
    approved: list[bool] = []
    for index in range(GRID_SAMPLE_COUNT):
        if counts[index] <= 0:
            value_rows.append(None)
            approved.append(False)
            continue
        good_fraction = counts[index] / totals[index] if totals[index] > 0 else 0.0
        if good_fraction < 0.5:
            value_rows.append(None)
            approved.append(False)
            continue
        value_rows.append(float(sums[index] / counts[index]))
        approved.append(True)
    return value_rows, approved


def read_lst(
    entries: list[tuple[str, Any, Any]],
    day: date,
    fetched_at: datetime,
) -> dict[str, Any]:
    """Aggregate quality-approved VNP21A1D daytime pixels into the Nepal grid."""
    if not entries:
        raise RuntimeError("No VNP21A1D granules were supplied for this day.")
    sums, counts, totals = _grid_accumulators()
    granule_ids: list[str] = []
    for granule_id, handle, _ in entries:
        tile_h, tile_v = _tile_from_granule(granule_id)
        import h5py

        with h5py.File(handle, "r") as dataset:
            lst_dataset = _find_dataset(dataset, "LST_1KM")
            qc_dataset = _find_dataset(dataset, "QC", near="LST")
            qc_fill = float(qc_dataset.attrs.get("_FillValue", 255))
            values, finite, _ = _scaled(lst_dataset)
            qc = np.asarray(qc_dataset[()])
        kelvin = values
        valid = (
            finite
            & (qc != qc_fill)
            & ((qc & 0b11) == 0)
            & (kelvin >= 180.0)
            & (kelvin <= 400.0)
        )
        _bin_tile(tile_h, tile_v, kelvin - 273.15, valid, sums, counts, totals)
        granule_ids.append(granule_id)

    latitudes, longitudes, _, _ = _grid_centers()
    celsius, approved = _grid_cells(sums, counts, totals)
    cells = [
        {
            "latitude": round(float(latitudes[index // GRID_COLS]), 3),
            "longitude": round(float(longitudes[index % GRID_COLS]), 3),
            "lst_day_c": round(celsius[index], 2) if approved[index] else None,
            "lst_night_c": None,
            "qc_good": approved[index],
            "clear_sky": approved[index],
        }
        for index in range(GRID_SAMPLE_COUNT)
    ]
    return LstSnapshot(
        product=PRODUCTS["lst"].short_name,
        version=PRODUCTS["lst"].version,
        data_date=day,
        fetched_at=fetched_at,
        resolution_km=GRID_SPACING_KM,
        grid_spacing_km=GRID_SPACING_KM,
        granule_ids=granule_ids,
        cells=cells,
    ).model_dump(mode="json")


def read_vegetation(
    entries: list[tuple[str, Any, Any]],
    begin: date,
    end: date,
    fetched_at: datetime,
) -> dict[str, Any]:
    """Aggregate quality-approved VNP13A1 NDVI/EVI pixels into the Nepal grid."""
    if not entries:
        raise RuntimeError("No VNP13A1 granules were supplied for this composite.")
    ndvi_sum, ndvi_count, totals = _grid_accumulators()
    evi_sum = np.zeros(GRID_SAMPLE_COUNT, dtype=float)
    evi_count = np.zeros(GRID_SAMPLE_COUNT, dtype=float)
    granule_ids: list[str] = []
    for granule_id, handle, _ in entries:
        tile_h, tile_v = _tile_from_granule(granule_id)
        import h5py

        with h5py.File(handle, "r") as dataset:
            ndvi_dataset = _find_dataset(dataset, "500 m 16 days NDVI")
            evi_dataset = _find_dataset(dataset, "500 m 16 days EVI")
            reliability_dataset = _find_dataset(dataset, "500 m 16 days pixel reliability")
            ndvi, ndvi_finite, _ = _scaled(ndvi_dataset)
            evi, evi_finite, _ = _scaled(evi_dataset)
            reliability = np.asarray(reliability_dataset[()])
        good = reliability == 0
        ndvi_valid = ndvi_finite & good & (ndvi >= -1.0) & (ndvi <= 1.0)
        evi_valid = evi_finite & good & (evi >= -1.0) & (evi <= 1.0)
        _bin_tile(tile_h, tile_v, ndvi, ndvi_valid, ndvi_sum, ndvi_count, totals)
        _bin_tile(tile_h, tile_v, evi, evi_valid, evi_sum, evi_count, totals)
        granule_ids.append(granule_id)

    latitudes, longitudes, _, _ = _grid_centers()
    ndvi_values, ndvi_approved = _grid_cells(ndvi_sum, ndvi_count, totals)
    evi_values, evi_approved = _grid_cells(evi_sum, evi_count, totals)
    approved = [left and right for left, right in zip(ndvi_approved, evi_approved)]
    cells = [
        {
            "latitude": round(float(latitudes[index // GRID_COLS]), 3),
            "longitude": round(float(longitudes[index % GRID_COLS]), 3),
            "ndvi": round(ndvi_values[index], 4) if approved[index] else None,
            "evi": round(evi_values[index], 4) if approved[index] else None,
            "qa_good": approved[index],
        }
        for index in range(GRID_SAMPLE_COUNT)
    ]
    return VegSnapshot(
        product=PRODUCTS["vegetation"].short_name,
        version=PRODUCTS["vegetation"].version,
        composite_start=begin,
        composite_end=end,
        fetched_at=fetched_at,
        resolution_m=GRID_SPACING_M,
        grid_spacing_m=GRID_SPACING_M,
        granule_ids=granule_ids,
        cells=cells,
    ).model_dump(mode="json")


def _write_staged(source: str, day: date, payload: dict[str, Any]) -> Path:
    target = incoming_dir(source) / f"{day.isoformat()}.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, indent=2, ensure_ascii=False, sort_keys=True) + "\n"
    with tempfile.NamedTemporaryFile(
        "w",
        encoding="utf-8",
        dir=target.parent,
        prefix=target.name + ".",
        suffix=".tmp",
        delete=False,
    ) as handle:
        handle.write(text)
        temporary = Path(handle.name)
    try:
        os.replace(temporary, target)
    except OSError:
        temporary.unlink(missing_ok=True)
        raise
    return target


def _login(settings: Any) -> None:
    """Authenticate with Earthdata Login through its environment strategy.

    earthaccess 0.17 has no ``token`` argument; it reads ``EARTHDATA_TOKEN``
    (or ``EARTHDATA_USERNAME``/``EARTHDATA_PASSWORD``) from the environment.
    """
    import earthaccess

    if settings.earthdata_username:
        os.environ["EARTHDATA_USERNAME"] = settings.earthdata_username
    if settings.earthdata_password:
        os.environ["EARTHDATA_PASSWORD"] = settings.earthdata_password
    if settings.earthdata_token:
        os.environ["EARTHDATA_TOKEN"] = settings.earthdata_token
    if not (
        settings.earthdata_token
        or (settings.earthdata_username and settings.earthdata_password)
    ):
        raise RuntimeError(
            "No Earthdata credentials are configured. Set EARTHDATA_TOKEN or "
            "EARTHDATA_USERNAME plus EARTHDATA_PASSWORD in backend/.env."
        )
    if not earthaccess.login(strategy="environment"):
        raise RuntimeError(
            "NASA Earthdata authentication failed. Check EARTHDATA_TOKEN or "
            "EARTHDATA_USERNAME/EARTHDATA_PASSWORD in backend/.env."
        )


def _earthaccess_open(ref: GranuleRef) -> Any:
    import earthaccess

    return earthaccess.open([ref.handle], show_progress=False)[0]


def _close(handle: Any) -> None:
    close = getattr(handle, "close", None)
    if callable(close):
        close()


def build_payload(
    source: str,
    availability: Availability,
    *,
    fetched_at: datetime,
    open_fn: Callable[[GranuleRef], Any] | None = None,
) -> dict[str, Any]:
    opener = open_fn or _earthaccess_open
    entries: list[tuple[str, Any, Any]] = []
    try:
        for ref in availability.granules:
            entries.append((ref.granule_id, opener(ref), ref.handle))
        if source == "smap":
            assert availability.day is not None
            return read_smap(entries, availability.day, fetched_at)
        if source == "lst":
            assert availability.day is not None
            return read_lst(entries, availability.day, fetched_at)
        if source == "vegetation":
            assert availability.begin is not None and availability.end is not None
            return read_vegetation(entries, availability.begin, availability.end, fetched_at)
    finally:
        for _, handle, _ in entries:
            _close(handle)
    raise ValueError(f"Unknown product source '{source}'")


def refresh_snapshots(
    settings: Any,
    today: date,
    *,
    root: Path | None = None,
    sources: tuple[str, ...] = ("smap", "lst", "vegetation"),
    search_fn: Callable[[ProductSpec, date, date], list[Any]] | None = None,
    open_fn: Callable[[GranuleRef], Any] | None = None,
) -> list[ProductResult]:
    """Download and stage the newest available day/composite for each source."""
    if search_fn is None:
        try:
            _login(settings)
        except Exception as exc:  # one authentication failure blocks every product
            return [
                ProductResult(
                    source=source,
                    status="error",
                    error=f"{type(exc).__name__}: {exc}",
                )
                for source in sources
            ]
    results: list[ProductResult] = []
    for source in sources:
        try:
            refs = search_granules(source, today, search_fn=search_fn)
            availability = availability_for(source, refs, today)
            if availability.day is None:
                results.append(
                    ProductResult(
                        source=source,
                        status="not_available",
                        error=availability.reason
                        or f"No published {PRODUCTS[source].short_name} data is available.",
                    )
                )
                continue
            installed = latest_snapshot_date(source, root)
            if installed is not None and availability.day <= installed:
                results.append(
                    ProductResult(
                        source=source,
                        status="up_to_date",
                        day=availability.day,
                        granule_ids=[ref.granule_id for ref in availability.granules],
                    )
                )
                continue
            payload = build_payload(
                source,
                availability,
                fetched_at=datetime.now(timezone.utc).replace(microsecond=0),
                open_fn=open_fn,
            )
            _write_staged(source, availability.day, payload)
            results.append(
                ProductResult(
                    source=source,
                    status="staged",
                    day=availability.day,
                    granule_ids=[ref.granule_id for ref in availability.granules],
                )
            )
        except Exception as exc:  # one product failure must not stop the others
            results.append(
                ProductResult(
                    source=source,
                    status="error",
                    error=f"{type(exc).__name__}: {exc}",
                )
            )
    return results
