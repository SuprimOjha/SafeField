import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

from app.ingest import products
from app.ingest.products import (
    GranuleRef,
    ProductResult,
    availability_for,
    daily_availability,
    read_lst,
    read_smap,
    read_vegetation,
    refresh_snapshots,
    smap_availability,
    vegetation_availability,
)
from app.ingest.shared import write_snapshot
from app.signals.snapshots import LstSnapshot, SmapSnapshot, VegSnapshot

TODAY = date(2026, 11, 15)
FIXED_FETCHED = datetime(2026, 11, 15, 6, 0, tzinfo=timezone.utc)


def smap_file(path: Path, *, lat_first: float = 26.0, two_dimensional: bool = False) -> Path:
    """Synthetic SPL4SMGP-shaped file: 9 km grid over Nepal plus one fill pixel."""
    import h5py

    latitudes = lat_first + np.arange(51) * 0.1
    longitudes = 79.5 + np.arange(91) * 0.1
    surface = np.full((51, 91), 0.25, dtype=np.float32)
    root = np.full((51, 91), 0.21, dtype=np.float32)
    surface[5, 5] = -9999.0
    root[5, 5] = -9999.0
    with h5py.File(path, "w") as handle:
        if two_dimensional:
            handle.create_dataset("cell_lat", data=np.broadcast_to(latitudes[:, None], surface.shape))
            handle.create_dataset("cell_lon", data=np.broadcast_to(longitudes[None, :], surface.shape))
        else:
            handle.create_dataset("cell_lat", data=latitudes)
            handle.create_dataset("cell_lon", data=longitudes)
        group = handle.create_group("Geophysical_Data")
        surface_field = group.create_dataset("sm_surface", data=surface)
        surface_field.attrs["_FillValue"] = -9999.0
        root_field = group.create_dataset("sm_rootzone", data=root)
        root_field.attrs["_FillValue"] = -9999.0
    return path


def viirs_file(path: Path, *, lst_value: int = 15000, ndvi_value: int = 5000, evi_value: int = 3000) -> Path:
    """Synthetic VIIRS sinusoidal tile (h25v06) for the LST and vegetation readers."""
    import h5py

    rows = cols = 24
    with h5py.File(path, "w") as handle:
        lst = handle.create_dataset("LST_1KM", data=np.full((rows, cols), lst_value, dtype=np.int16))
        lst.attrs["scale_factor"] = 0.02
        lst.attrs["_FillValue"] = 0
        qc = handle.create_dataset("QC", data=np.zeros((rows, cols), dtype=np.uint8))
        qc.attrs["_FillValue"] = 255

        fields = handle.create_group("HDFEOS").create_group("GRIDS")
        grid = fields.create_group("VIIRS_Grid_16Day_VI_500m").create_group("Data Fields")
        ndvi = grid.create_dataset("500 m 16 days NDVI", data=np.full((rows, cols), ndvi_value, dtype=np.int16))
        ndvi.attrs["scale_factor"] = 0.0001
        ndvi.attrs["_FillValue"] = -15000
        evi = grid.create_dataset("500 m 16 days EVI", data=np.full((rows, cols), evi_value, dtype=np.int16))
        evi.attrs["scale_factor"] = 0.0001
        evi.attrs["_FillValue"] = -15000
        grid.create_dataset("500 m 16 days pixel reliability", data=np.zeros((rows, cols), dtype=np.int8))
    return path


def coarse_nepal_grid(monkeypatch) -> None:
    """A coarse grid that the 24-pixel synthetic tile actually covers."""
    monkeypatch.setattr(products, "GRID_MIN_LAT", 20.0)
    monkeypatch.setattr(products, "GRID_MIN_LON", 79.0)
    monkeypatch.setattr(products, "GRID_STEP_DEGREES", 1.0)
    monkeypatch.setattr(products, "GRID_ROWS", 10)
    monkeypatch.setattr(products, "GRID_COLS", 11)
    monkeypatch.setattr(products, "GRID_SAMPLE_COUNT", 110)


def test_read_smap_averages_granules_and_keeps_real_coordinates(tmp_path):
    path = smap_file(tmp_path / "smap.h5")
    entries = [(f"SPL4SMGP.008:SMAP_L4_SM_gph_20261114T0{hour}0000_Vv8040_001.h5", open(path, "rb"), None) for hour in range(0, 24, 3)]
    try:
        payload = read_smap(entries, date(2026, 11, 14), FIXED_FETCHED)
    finally:
        for _, handle, _ in entries:
            handle.close()

    snapshot = SmapSnapshot.model_validate(payload)
    assert snapshot.product == "SPL4SMGP"
    assert snapshot.version == "008"
    assert snapshot.resolution_km == 9.0
    assert snapshot.grid_spacing_km == 9.0
    assert len(snapshot.granule_ids) == 8
    assert 0 < snapshot.coverage_fraction < 1
    good = [cell for cell in snapshot.cells if cell.quality == "good"]
    assert good and all(cell.surface_sm == pytest.approx(0.25) for cell in good)
    missing = [(cell.latitude, cell.longitude) for cell in snapshot.cells if cell.quality == "missing"]
    assert missing == [(26.5, 80.0)]
    # Every cell lies inside the Nepal bounding box.
    assert all(26.3 <= cell.latitude <= 30.5 for cell in snapshot.cells)
    assert all(80.0 <= cell.longitude <= 88.3 for cell in snapshot.cells)


def test_read_smap_handles_two_dimensional_geolocation(tmp_path):
    path = smap_file(tmp_path / "smap.h5", two_dimensional=True)
    handle = open(path, "rb")
    try:
        payload = read_smap(
            [("SPL4SMGP.008:SMAP_L4_SM_gph_20261114T030000.h5", handle, None)],
            date(2026, 11, 14),
            FIXED_FETCHED,
        )
    finally:
        handle.close()

    snapshot = SmapSnapshot.model_validate(payload)
    assert snapshot.cells
    assert any(cell.quality == "good" for cell in snapshot.cells)
    assert all(cell.quality in {"good", "missing"} for cell in snapshot.cells)


def test_read_lst_converts_kelvin_to_celsius_and_filters_quality(tmp_path, monkeypatch):
    coarse_nepal_grid(monkeypatch)
    path = viirs_file(tmp_path / "lst.h5")
    handle = open(path, "rb")
    try:
        payload = read_lst(
            [("VNP21A1D.A2026318.h25v06.002.2026319000000.h5", handle, None)],
            date(2026, 11, 14),
            FIXED_FETCHED,
        )
    finally:
        handle.close()

    snapshot = LstSnapshot.model_validate(payload)
    approved = [cell for cell in snapshot.cells if cell.qc_good]
    assert approved, "the synthetic tile must cover part of the coarse grid"
    assert all(cell.lst_day_c == pytest.approx(26.85, abs=0.01) for cell in approved)
    assert all(cell.clear_sky for cell in approved)
    assert all(cell.lst_night_c is None for cell in snapshot.cells)


def test_read_lst_drops_pixels_flagged_by_qc(tmp_path, monkeypatch):
    coarse_nepal_grid(monkeypatch)
    path = viirs_file(tmp_path / "lst.h5")
    import h5py

    with h5py.File(path, "r+") as handle:
        handle["QC"][...] = 2  # "LST not produced: cloud"
    handle = open(path, "rb")
    try:
        payload = read_lst(
            [("VNP21A1D.A2026318.h25v06.002.2026319000000.h5", handle, None)],
            date(2026, 11, 14),
            FIXED_FETCHED,
        )
    finally:
        handle.close()

    snapshot = LstSnapshot.model_validate(payload)
    assert all(cell.lst_day_c is None for cell in snapshot.cells)
    assert not any(cell.qc_good for cell in snapshot.cells)


def test_read_vegetation_scales_ndvi_and_evi(tmp_path, monkeypatch):
    coarse_nepal_grid(monkeypatch)
    path = viirs_file(tmp_path / "veg.h5")
    handle = open(path, "rb")
    try:
        payload = read_vegetation(
            [("VNP13A1.A2026305.h25v06.002.2026321000000.h5", handle, None)],
            date(2026, 11, 1),
            date(2026, 11, 16),
            FIXED_FETCHED,
        )
    finally:
        handle.close()

    snapshot = VegSnapshot.model_validate(payload)
    assert snapshot.composite_start == date(2026, 11, 1)
    assert snapshot.composite_end == date(2026, 11, 16)
    approved = [cell for cell in snapshot.cells if cell.qa_good]
    assert approved
    assert all(cell.ndvi == pytest.approx(0.5) for cell in approved)
    assert all(cell.evi == pytest.approx(0.3) for cell in approved)


def ref(granule_id: str, begin: str, end: str) -> GranuleRef:
    return GranuleRef(
        granule_id=granule_id,
        begin=datetime.fromisoformat(begin),
        end=datetime.fromisoformat(end),
    )


def smap_ref(day: date, hour: int) -> GranuleRef:
    start = datetime(day.year, day.month, day.day, hour, tzinfo=timezone.utc)
    return GranuleRef(
        # Real IDs are stamped 90 minutes after the window start, e.g. 04:30 for 03:00.
        granule_id=f"SMAP_L4_SM_gph_{day:%Y%m%d}T{hour + 1:02d}3000_Vv8013_001.h5",
        begin=start,
        end=start + timedelta(hours=3),
    )


def test_smap_availability_requires_all_eight_hours_of_a_completed_day():
    partial = [smap_ref(date(2026, 11, 14), hour) for hour in range(0, 18, 3)]
    complete = [smap_ref(date(2026, 11, 13), hour) for hour in range(0, 24, 3)]

    availability = smap_availability(partial + complete, TODAY)

    assert availability.day == date(2026, 11, 13)
    assert len(availability.granules) == 8


def test_smap_availability_reports_when_no_day_is_complete():
    availability = smap_availability([], TODAY)
    assert availability.day is None
    assert availability.reason and "SPL4SMGP" in availability.reason


def test_daily_and_vegetation_availability_choose_the_newest_periods():
    daily = [
        ref("VNP21A1D.A2026316.h25v06.002.h5", "2026-11-12T00:00:00+00:00", "2026-11-13T00:00:00+00:00"),
        ref("VNP21A1D.A2026317.h25v05.002.h5", "2026-11-13T00:00:00+00:00", "2026-11-14T00:00:00+00:00"),
        ref("VNP21A1D.A2026318.h25v06.002.h5", "2026-11-15T00:00:00+00:00", "2026-11-16T00:00:00+00:00"),
    ]
    assert daily_availability(daily, TODAY).day == date(2026, 11, 13)

    composites = [
        ref("VNP13A1.A2026290.h25v06.002.h5", "2026-10-17T00:00:00+00:00", "2026-11-01T00:00:00+00:00"),
        ref("VNP13A1.A2026306.h25v06.002.h5", "2026-11-02T00:00:00+00:00", "2026-11-17T00:00:00+00:00"),
    ]
    availability = vegetation_availability(composites, TODAY)
    assert availability.day == date(2026, 11, 1)
    assert availability.begin == date(2026, 10, 17)
    assert availability_for("vegetation", composites, TODAY) == availability


def smap_granule(day: date, hour: int) -> dict:
    start = datetime(day.year, day.month, day.day, hour, tzinfo=timezone.utc)
    end = start + timedelta(hours=3)
    return {
        "umm": {
            "GranuleUR": f"SMAP_L4_SM_gph_{day:%Y%m%d}T{hour + 1:02d}3000_Vv8013_001.h5",
            "TemporalExtent": {
                "RangeDateTime": {
                    "BeginningDateTime": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
                    "EndingDateTime": end.strftime("%Y-%m-%dT%H:%M:%SZ"),
                }
            },
        }
    }


def test_refresh_snapshots_stages_once_then_reports_up_to_date(tmp_path, monkeypatch):
    monkeypatch.setenv("SAFEFIELD_INCOMING_DIR", str(tmp_path / "incoming"))
    path = smap_file(tmp_path / "smap.h5")
    day = date(2026, 11, 14)
    granules = [smap_granule(day, hour) for hour in range(0, 24, 3)]
    ids = [granule["umm"]["GranuleUR"] for granule in granules]

    opened: list[int] = []

    def open_fn(reference: GranuleRef):
        opened.append(1)
        return open(path, "rb")

    results = refresh_snapshots(
        SimpleNamespace(),
        TODAY,
        sources=("smap",),
        search_fn=lambda spec, start, end: granules,
        open_fn=open_fn,
    )

    assert results == [
        ProductResult(source="smap", status="staged", day=date(2026, 11, 14), granule_ids=ids)
    ]
    assert len(opened) == 8
    staged = tmp_path / "incoming" / "smap" / "2026-11-14.json"
    payload = json.loads(staged.read_text(encoding="utf-8"))
    assert SmapSnapshot.model_validate(payload).granule_ids == ids

    root = tmp_path / "signals"
    write_snapshot("smap", date(2026, 11, 14), payload, root=root)
    second = refresh_snapshots(
        SimpleNamespace(),
        TODAY,
        root=root,
        sources=("smap",),
        search_fn=lambda spec, start, end: granules,
        open_fn=open_fn,
    )
    assert second[0].status == "up_to_date"


def test_refresh_snapshots_keeps_other_products_when_one_fails(tmp_path, monkeypatch):
    monkeypatch.setenv("SAFEFIELD_INCOMING_DIR", str(tmp_path / "incoming"))
    smap_path = smap_file(tmp_path / "smap.h5")

    def search_fn(spec, start, end):
        if spec.source == "smap":
            return [smap_granule(date(2026, 11, 14), hour) for hour in range(0, 24, 3)]
        return [
            {
                "umm": {
                    "GranuleUR": "VNP21A1D.A2026318.h25v06.002.2026319000000.h5",
                    "TemporalExtent": {
                        "RangeDateTime": {
                            "BeginningDateTime": "2026-11-14T00:00:00Z",
                            "EndingDateTime": "2026-11-15T00:00:00Z",
                        }
                    },
                }
            }
        ]

    def open_fn(reference: GranuleRef):
        if reference.granule_id.startswith("VNP21A1D"):
            raise RuntimeError("simulated read failure")
        return open(smap_path, "rb")

    results = refresh_snapshots(
        SimpleNamespace(),
        TODAY,
        sources=("smap", "lst"),
        search_fn=search_fn,
        open_fn=open_fn,
    )

    by_source = {result.source: result for result in results}
    assert by_source["smap"].status == "staged"
    assert by_source["lst"].status == "error"
    assert "simulated read failure" in (by_source["lst"].error or "")


def test_refresh_snapshots_reports_missing_data_without_staging(tmp_path, monkeypatch):
    monkeypatch.setenv("SAFEFIELD_INCOMING_DIR", str(tmp_path / "incoming"))

    results = refresh_snapshots(
        SimpleNamespace(),
        TODAY,
        sources=("lst",),
        search_fn=lambda spec, start, end: [],
        open_fn=lambda reference: pytest.fail("no file should be opened"),
    )

    assert results[0].status == "not_available"
    assert "VNP21A1D" in (results[0].error or "")
    assert not (tmp_path / "incoming").exists()
