from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

from app.signals.anomaly import compute_anomaly
from app.signals.config import SignalGates, get_gates
from app.signals.models import SignalName, SignalProvenance, SignalValue
from app.signals.snapshots import (
    SmapSnapshot,
    SnapshotFormatError,
    load_latest_snapshot,
    load_snapshot_on,
    nearest_cell,
    snapshot_dates,
    valid_coverage,
)


SMAP_SOURCE = "smap"
SURFACE_NAME: SignalName = "soil_moisture_surface"
ROOT_NAME: SignalName = "soil_moisture_root"


class SmapProvider:
    """Read SMAP L4 daily-mean soil moisture from installed snapshots."""

    name = "smap"

    def __init__(self, root: Path | None = None, gates: SignalGates | None = None) -> None:
        self.root = root
        self.gates = gates or get_gates()

    def get_signal(self, latitude: float, longitude: float, today: date | None = None) -> SignalValue:
        return self._build(SURFACE_NAME, latitude, longitude, today or date.today())

    def get_root_signal(self, latitude: float, longitude: float, today: date | None = None) -> SignalValue:
        return self._build(ROOT_NAME, latitude, longitude, today or date.today())

    def get_signals(self, latitude: float, longitude: float, today: date | None = None) -> dict[SignalName, SignalValue]:
        current = today or date.today()
        return {
            SURFACE_NAME: self._build(SURFACE_NAME, latitude, longitude, current),
            ROOT_NAME: self._build(ROOT_NAME, latitude, longitude, current),
        }

    def _build(self, name: SignalName, latitude: float, longitude: float, today: date) -> SignalValue:
        try:
            loaded = load_latest_snapshot(SMAP_SOURCE, SmapSnapshot, today, self.root)
        except SnapshotFormatError as exc:
            return _unavailable(name, f"Installed SMAP snapshot is malformed: {exc}")
        if loaded is None:
            return _unavailable(
                name,
                "No SMAP L4 snapshot is installed. Run the SMAP ingest job before this signal can be shown.",
                status="not_installed",
            )

        _, snapshot = loaded
        field = "surface_sm" if name == SURFACE_NAME else "root_sm"
        valid_cells = [
            cell
            for cell in snapshot.cells
            if cell.quality == "good" and getattr(cell, field) is not None
        ]
        coverage = (
            snapshot.coverage_fraction
            if snapshot.coverage_fraction is not None
            else valid_coverage(snapshot.cells, [cell in valid_cells for cell in snapshot.cells])
        )
        cell = nearest_cell(valid_cells, latitude, longitude)
        if cell is None:
            return _unavailable(
                name,
                "No quality-approved SMAP cell around this field has a valid value for the latest day.",
            )

        value = getattr(cell, field)
        age_days = (today - snapshot.data_date).days
        stale = age_days > self.gates.max_age_days_for(SMAP_SOURCE)
        partial = coverage < self.gates.min_snapshot_coverage
        notes: list[str] = []
        if stale:
            notes.append(f"Latest installed SMAP day is {age_days} days old; this is not live data.")
        if partial:
            notes.append(
                f"Quality-approved coverage around the field is {coverage:.0%}, below the "
                f"{self.gates.min_snapshot_coverage:.0%} software gate."
            )
        if snapshot.model_only:
            notes.append("SMAP L4 reports a model-only period at this date; no SMAP observation was assimilated.")
        if partial:
            status = "partial"
        elif stale:
            status = "stale"
        else:
            status = "available"

        anomaly = compute_anomaly(
            self._history(field, latitude, longitude, today),
            snapshot.data_date,
            float(value),
            self.gates,
        )
        if anomaly.reason:
            notes.append(anomaly.reason)

        provenance = _provenance(snapshot, coverage)
        return SignalValue(
            name=name,
            status=status,  # type: ignore[arg-type]
            value=round(float(value), 4),
            unit="m³/m³ (volumetric)",
            vs_normal=anomaly.vs_normal,
            anomaly=anomaly.anomaly,
            baseline=anomaly.baseline,
            baseline_years=anomaly.years_used,
            provenance=provenance,
            quality_note=" ".join(notes) if notes else None,
        )

    def _history(
        self, field: str, latitude: float, longitude: float, today: date
    ) -> list[tuple[date, float | None]]:
        series: list[tuple[date, float | None]] = []
        for day in snapshot_dates(SMAP_SOURCE, self.root):
            if day > today:
                continue
            try:
                snapshot = load_snapshot_on(SMAP_SOURCE, SmapSnapshot, day, self.root)
            except SnapshotFormatError:
                # The current-day snapshot error is reported to the caller; a
                # malformed historical file is skipped so it cannot fabricate a
                # baseline value.
                continue
            if snapshot is None:
                continue
            valid = [
                cell
                for cell in snapshot.cells
                if cell.quality == "good" and getattr(cell, field) is not None
            ]
            cell = nearest_cell(valid, latitude, longitude)
            series.append((day, float(getattr(cell, field)) if cell is not None else None))
        return series


def _provenance(snapshot: SmapSnapshot, coverage: float) -> SignalProvenance:
    day_start = datetime.combine(snapshot.data_date, time.min, tzinfo=timezone.utc)
    caveat = (
        "SMAP L4 is model-derived with assimilated satellite observations; it is not a "
        "field probe or a volumetric soil test. Daily value is a mean of the product's "
        "3-hourly fields for the completed UTC day."
    )
    if snapshot.model_only:
        caveat += " This date is flagged model-only because no SMAP observation was assimilated."
    return SignalProvenance(
        source_name="NASA SMAP L4 Surface and Root Zone Soil Moisture",
        product=snapshot.product,
        version=snapshot.version,
        kind="model",
        is_nasa=True,
        valid_date=snapshot.data_date,
        observed_start=day_start,
        observed_end=day_start + timedelta(days=1),
        fetched_at=snapshot.fetched_at,
        spatial_resolution=f"{snapshot.resolution_km:g} km EASE-Grid",
        latency_note=(
            "SMAP L4 is produced 3-hourly; a daily mean becomes usable after the UTC day closes. "
            "Publication lag varies and is reported by the ingestion job."
        ),
        granule_ids=snapshot.granule_ids,
        coverage_fraction=round(coverage, 4),
        model_only=snapshot.model_only,
        caveat=caveat,
    )


def _unavailable(name: SignalName, reason: str, status: str = "unavailable") -> SignalValue:
    return SignalValue(
        name=name,
        status=status,  # type: ignore[arg-type]
        unavailable_reason=reason,
    )
