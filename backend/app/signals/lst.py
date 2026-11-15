from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

from app.signals.anomaly import compute_anomaly
from app.signals.config import SignalGates, get_gates
from app.signals.models import SignalName, SignalProvenance, SignalValue
from app.signals.snapshots import (
    LstSnapshot,
    SnapshotFormatError,
    load_latest_snapshot,
    load_snapshot_on,
    nearest_cell,
    snapshot_dates,
)


LST_SOURCE = "lst"
HEAT_SURFACE: SignalName = "heat_surface"


class LstProvider:
    """Read quality-filtered land surface temperature from installed snapshots."""

    name = "lst"

    def __init__(self, root: Path | None = None, gates: SignalGates | None = None) -> None:
        self.root = root
        self.gates = gates or get_gates()

    def get_signal(self, latitude: float, longitude: float, today: date | None = None) -> SignalValue:
        current = today or date.today()
        try:
            loaded = load_latest_snapshot(LST_SOURCE, LstSnapshot, current, self.root)
        except SnapshotFormatError as exc:
            return _unavailable(f"Installed LST snapshot is malformed: {exc}")
        if loaded is None:
            return _unavailable(
                "No land surface temperature snapshot is installed. Run the LST ingest job before this signal can be shown.",
                status="not_installed",
            )

        _, snapshot = loaded
        valid_cells = [
            cell
            for cell in snapshot.cells
            if cell.qc_good and cell.clear_sky and cell.lst_day_c is not None
        ]
        coverage = len(valid_cells) / len(snapshot.cells) if snapshot.cells else 0.0
        if not valid_cells or coverage < self.gates.min_clear_sky_fraction:
            return _unavailable(
                "No clear observation: the latest LST snapshot has "
                f"{coverage:.0%} quality-approved clear pixels around this field, below the "
                f"{self.gates.min_clear_sky_fraction:.0%} software gate."
            )

        cell = nearest_cell(valid_cells, latitude, longitude)
        if cell is None:
            return _unavailable("No quality-approved clear LST cell is available for this field.")

        age_days = (current - snapshot.data_date).days
        stale = age_days > self.gates.max_age_days_for(LST_SOURCE)
        anomaly = compute_anomaly(
            self._history(latitude, longitude, current),
            snapshot.data_date,
            float(cell.lst_day_c),
            self.gates,
        )
        notes = [
            f"{coverage:.0%} of the snapshot pixels passed quality and clear-sky checks around the field."
        ]
        if stale:
            notes.append(f"Latest installed LST day is {age_days} days old; this is not live data.")
        if anomaly.reason:
            notes.append(anomaly.reason)

        return SignalValue(
            name=HEAT_SURFACE,
            status="stale" if stale else "available",
            value=round(float(cell.lst_day_c), 2),
            unit="°C (daytime surface skin)",
            vs_normal=anomaly.vs_normal,
            anomaly=anomaly.anomaly,
            baseline=anomaly.baseline,
            baseline_years=anomaly.years_used,
            provenance=_provenance(snapshot, coverage),
            quality_note=" ".join(notes),
        )

    def _history(
        self, latitude: float, longitude: float, today: date
    ) -> list[tuple[date, float | None]]:
        series: list[tuple[date, float | None]] = []
        for day in snapshot_dates(LST_SOURCE, self.root):
            if day > today:
                continue
            try:
                snapshot = load_snapshot_on(LST_SOURCE, LstSnapshot, day, self.root)
            except SnapshotFormatError:
                continue
            if snapshot is None:
                continue
            valid = [
                cell
                for cell in snapshot.cells
                if cell.qc_good and cell.clear_sky and cell.lst_day_c is not None
            ]
            cell = nearest_cell(valid, latitude, longitude)
            series.append((day, float(cell.lst_day_c) if cell is not None else None))
        return series


def _provenance(snapshot: LstSnapshot, coverage: float) -> SignalProvenance:
    day_start = datetime.combine(snapshot.data_date, time.min, tzinfo=timezone.utc)
    return SignalProvenance(
        source_name="NASA Land Surface Temperature (MODIS/VIIRS daily)",
        product=snapshot.product,
        version=snapshot.version,
        kind="observation",
        is_nasa=True,
        valid_date=snapshot.data_date,
        observed_start=day_start,
        observed_end=day_start + timedelta(days=1),
        fetched_at=snapshot.fetched_at,
        spatial_resolution=f"{snapshot.resolution_km:g} km daily grid",
        latency_note=(
            "Daily land surface temperature product. Near-real-time latency varies by "
            "instrument; the data date is authoritative, never the fetch time."
        ),
        granule_ids=snapshot.granule_ids,
        coverage_fraction=round(coverage, 4),
        caveat=(
            "Land surface temperature is the temperature of the surface skin as seen from "
            "space, not air temperature at 2 m and not a measurement inside the crop canopy. "
            "Cloudy or poor-quality pixels are discarded by the ingestion pipeline."
        ),
    )


def _unavailable(reason: str, status: str = "unavailable") -> SignalValue:
    return SignalValue(
        name=HEAT_SURFACE,
        status=status,  # type: ignore[arg-type]
        unavailable_reason=reason,
    )
