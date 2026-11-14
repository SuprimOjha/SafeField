from datetime import date, datetime, timedelta, timezone
import os
from pathlib import Path
from typing import Any
from app.config import get_settings
from app.services.imerg.grid_cache import ImergGridCache

NEPAL_BBOX = (80.0, 26.3, 88.3, 30.5)
COLLECTION = "GPM_3IMERGDL"
COLLECTION_VERSION = "07"


def _read_daily_granule(path: Path, observed_day: date) -> tuple[list[float], list[float], list[list[float | None]], list[list[int | None]]]:
    import numpy as np
    import xarray as xr

    with xr.open_dataset(path) as dataset:
        variable_names = list(dataset.data_vars)
        print(f"IMERG variables in {path.name}: {variable_names}")
        if "precipitation" not in dataset or "precipitation_cnt" not in dataset:
            raise RuntimeError("Expected V07 daily variables 'precipitation' and 'precipitation_cnt' are missing; inspect the printed variable list and NASA product metadata.")
        units = str(dataset["precipitation"].attrs.get("units", "")).strip().lower().replace(" ", "")
        if units not in {"mm/day", "mmd-1", "mmday-1"}:
            raise RuntimeError(f"Unexpected IMERG daily precipitation units '{units}'. No implicit unit conversion is performed.")
        if "lat" not in dataset.coords or "lon" not in dataset.coords:
            raise RuntimeError("IMERG granule does not expose expected lat/lon coordinates.")
        cropped = dataset.sortby("lat").sortby("lon").sel(lat=slice(NEPAL_BBOX[1], NEPAL_BBOX[3]), lon=slice(NEPAL_BBOX[0], NEPAL_BBOX[2]))
        if cropped.sizes.get("lat", 0) == 0 or cropped.sizes.get("lon", 0) == 0:
            raise RuntimeError("IMERG granule has no grid cells inside the Nepal bounding box.")
        precipitation = cropped["precipitation"].squeeze(drop=True)
        counts = cropped["precipitation_cnt"].squeeze(drop=True)
        precipitation = precipitation.transpose("lat", "lon")
        counts = counts.transpose("lat", "lon")
        values = np.array(precipitation.values, dtype=float, copy=True)
        sample_counts = np.array(counts.values, dtype=float, copy=True)
        values[~np.isfinite(values)] = np.nan
        sample_counts[~np.isfinite(sample_counts)] = 0
        precip_rows = [[None if not np.isfinite(value) or value < 0 else float(value) for value in row] for row in values]
        count_rows = [[None if count <= 0 else int(count) for count in row] for row in sample_counts]
        return cropped["lat"].values.tolist(), cropped["lon"].values.tolist(), precip_rows, count_rows


def fetch_imerg(days: int = 7, lookback_extra_days: int = 5, cache: ImergGridCache | None = None, today_utc: date | None = None) -> dict[str, Any]:
    if days < 1 or days > 30:
        raise ValueError("days must be between 1 and 30")
    import earthaccess

    settings = get_settings()
    if settings.earthdata_username:
        os.environ["EARTHDATA_USERNAME"] = settings.earthdata_username
    if settings.earthdata_password:
        os.environ["EARTHDATA_PASSWORD"] = settings.earthdata_password
    if settings.earthdata_token:
        os.environ["EARTHDATA_TOKEN"] = settings.earthdata_token
    if not earthaccess.login(strategy="environment"):
        raise RuntimeError("NASA Earthdata authentication failed. Set EARTHDATA_USERNAME and EARTHDATA_PASSWORD in the root .env file.")

    today = today_utc or datetime.now(timezone.utc).date()
    found: list[tuple[date, Any]] = []
    for offset in range(1, days + lookback_extra_days + 1):
        candidate = today - timedelta(days=offset)
        day_string = candidate.isoformat()
        granules = earthaccess.search_data(
            short_name=COLLECTION, version=COLLECTION_VERSION,
            temporal=(f"{day_string}T00:00:00Z", f"{day_string}T23:59:59Z"), bounding_box=NEPAL_BBOX, count=10,
        )
        if granules:
            found.append((candidate, granules[0]))
        if len(found) >= days:
            break
    if not found:
        raise RuntimeError(f"No {COLLECTION} V07 daily granules found within {days + lookback_extra_days} completed UTC days.")

    raw_dir = Path(__file__).resolve().parents[3] / "data" / "imerg" / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    downloaded = earthaccess.download([granule for _, granule in found], local_path=str(raw_dir))
    if len(downloaded) != len(found):
        raise RuntimeError(f"Downloaded {len(downloaded)} files for {len(found)} granules; refusing ambiguous date-to-file mapping.")

    grid_cache = cache or ImergGridCache()
    fetched_at = datetime.now(timezone.utc)
    processed = []
    for (observed_day, granule), file_path in zip(found, downloaded):
        path = Path(file_path)
        latitudes, longitudes, values, counts = _read_daily_granule(path, observed_day)
        granule_id = path.stem
        cell_count = grid_cache.store_daily_grid(observed_day, latitudes, longitudes, values, counts, granule_id, fetched_at)
        processed.append({"date_utc": observed_day.isoformat(), "granule_id": granule_id, "valid_cells": cell_count, "file": path.name})
    return {"collection": COLLECTION, "version": "07B", "stream": "LATE", "processed": processed}
