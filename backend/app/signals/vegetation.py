from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

from app.signals.anomaly import compute_anomaly
from app.signals.config import SignalGates, get_gates
from app.signals.models import SignalName, SignalProvenance, SignalValue
from app.signals.snapshots import (
    SnapshotFormatError,
    VegSnapshot,
    load_latest_snapshot,
    load_snapshot_on,
    nearest_cell,
    snapshot_dates,
    within_coverage,
)


VEG_SOURCE = "vegetation"
NDVI_NAME: SignalName = "ndvi"
EVI_NAME: SignalName = "evi"


class VegProvider:
    """Read NDVI/EVI from installed 16-day composite snapshots."""

    name = "vegetation"

    def __init__(self, root: Path | None = None, gates: SignalGates | None = None) -> None:
        self.root = root
        self.gates = gates or get_gates()

    def get_signal(self, latitude: float, longitude: float, today: date | None = None) -> SignalValue:
        return self._build(NDVI_NAME, latitude, longitude, today or date.today())

    def get_evi_signal(self, latitude: float, longitude: float, today: date | None = None) -> SignalValue:
        return self._build(EVI_NAME, latitude, longitude, today or date.today())

    def get_signals(self, latitude: float, longitude: float, today: date | None = None) -> dict[SignalName, SignalValue]:
        current = today or date.today()
        return {
            NDVI_NAME: self._build(NDVI_NAME, latitude, longitude, current),
            EVI_NAME: self._build(EVI_NAME, latitude, longitude, current),
        }

    def _build(self, name: SignalName, latitude: float, longitude: float, today: date) -> SignalValue:
        try:
            loaded = load_latest_snapshot(VEG_SOURCE, VegSnapshot, today, self.root)
        except SnapshotFormatError as exc:
            return _unavailable(name, f"Installed vegetation snapshot is malformed: {exc}")
        if loaded is None:
            return _unavailable(
                name,
                "No vegetation index snapshot is installed. Run the vegetation ingest job before this signal can be shown.",
                status="not_installed",
            )

        _, snapshot = loaded
        field = "ndvi" if name == NDVI_NAME else "evi"
        valid_cells = [
            cell for cell in snapshot.cells if cell.qa_good and getattr(cell, field) is not None
        ]
        coverage = len(valid_cells) / len(snapshot.cells) if snapshot.cells else 0.0
        if not valid_cells or coverage < self.gates.min_snapshot_coverage:
            return _unavailable(
                name,
                "Not enough clear images: the latest vegetation composite has "
                f"{coverage:.0%} quality-approved pixels around this field, below the "
                f"{self.gates.min_snapshot_coverage:.0%} software completeness gate.",
            )

        cell = nearest_cell(valid_cells, latitude, longitude)
        if cell is None:
            return _unavailable(name, "No quality-approved vegetation cell is available for this field.")
        if not within_coverage(cell, latitude, longitude, snapshot.resolution_m / 1000.0):
            return _unavailable(
                name,
                "The nearest installed vegetation cell does not cover this field. The installed "
                "snapshot only covers a pilot area; it is not extrapolated to distant fields.",
            )

        value = getattr(cell, field)
        age_days = (today - snapshot.composite_end).days
        stale = age_days > self.gates.max_age_days_for(VEG_SOURCE)
        anomaly = compute_anomaly(
            self._history(field, latitude, longitude, today),
            snapshot.composite_end,
            float(value),
            self.gates,
        )
        notes = [
            f"{coverage:.0%} of composite pixels around the field passed the product QA flags.",
            f"The composite covers {snapshot.composite_start.isoformat()} to "
            f"{snapshot.composite_end.isoformat()} ({age_days} days old).",
        ]
        if stale:
            notes.append(
                f"Latest installed composite end is {age_days} days old; this is not a current observation."
            )
        if anomaly.reason:
            notes.append(anomaly.reason)

        return SignalValue(
            name=name,
            status="stale" if stale else "available",
            value=round(float(value), 4),
            unit=f"{name.upper()} (unitless index, -1 to 1)",
            vs_normal=anomaly.vs_normal,
            anomaly=anomaly.anomaly,
            baseline=anomaly.baseline,
            baseline_years=anomaly.years_used,
            provenance=_provenance(snapshot, coverage),
            quality_note=" ".join(notes),
        )

    def _history(
        self, field: str, latitude: float, longitude: float, today: date
    ) -> list[tuple[date, float | None]]:
        series: list[tuple[date, float | None]] = []
        for day in snapshot_dates(VEG_SOURCE, self.root):
            if day > today:
                continue
            try:
                snapshot = load_snapshot_on(VEG_SOURCE, VegSnapshot, day, self.root)
            except SnapshotFormatError:
                continue
            if snapshot is None:
                continue
            valid = [
                cell for cell in snapshot.cells if cell.qa_good and getattr(cell, field) is not None
            ]
            cell = nearest_cell(valid, latitude, longitude)
            if cell is not None and not within_coverage(
                cell, latitude, longitude, snapshot.resolution_m / 1000.0
            ):
                cell = None
            series.append(
                (snapshot.composite_end, float(getattr(cell, field)) if cell is not None else None)
            )
        return series


def _provenance(snapshot: VegSnapshot, coverage: float) -> SignalProvenance:
    start = datetime.combine(snapshot.composite_start, time.min, tzinfo=timezone.utc)
    end = datetime.combine(snapshot.composite_end + timedelta(days=1), time.min, tzinfo=timezone.utc)
    return SignalProvenance(
        source_name="NASA Vegetation Index (MODIS/VIIRS 16-day composite)",
        product=snapshot.product,
        version=snapshot.version,
        kind="observation",
        is_nasa=True,
        valid_date=snapshot.composite_end,
        observed_start=start,
        observed_end=end,
        fetched_at=snapshot.fetched_at,
        spatial_resolution=f"{snapshot.resolution_m:g} m composite grid",
        latency_note=(
            "16-day composite. The product is published after the composite period ends, "
            "so the newest value can lag conditions in the field by weeks."
        ),
        granule_ids=snapshot.granule_ids,
        coverage_fraction=round(coverage, 4),
        caveat=(
            "Vegetation indices describe canopy greenness, not directly water stress or crop "
            "health. A 16-day composite can hide short stress events, and the pixel is much "
            "larger than a smallholder plot."
        ),
    )


def _unavailable(name: SignalName, reason: str, status: str = "unavailable") -> SignalValue:
    return SignalValue(
        name=name,
        status=status,  # type: ignore[arg-type]
        unavailable_reason=reason,
    )
