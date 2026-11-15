import json
import os
from datetime import date
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ValidationError

from app.ingest.shared import write_snapshot
from app.signals.snapshots import LstSnapshot, SmapSnapshot, VegSnapshot


SOURCE_MODELS: dict[str, type[BaseModel]] = {
    "smap": SmapSnapshot,
    "lst": LstSnapshot,
    "vegetation": VegSnapshot,
}

PRODUCTS = {
    "smap": ("SPL4SMGP", "008"),
    "lst": ("MOD11A1", "061"),
    "vegetation": ("MOD13Q1", "061"),
}


def incoming_dir(source: str | None = None) -> Path:
    override = os.environ.get("SAFEFIELD_INCOMING_DIR", "").strip()
    base = Path(override) if override else Path(__file__).resolve().parents[2] / "data" / "incoming"
    return base / source if source else base


class RawSnapshotAdapter:
    """Publish a validated raw snapshot produced by a verified reader.

    The raw file must already contain real source values. This adapter never
    fills gaps, interpolates, or invents a value; it only validates, normalises
    and installs the snapshot atomically.
    """

    def __init__(self, source: str, incoming_root: Path | None = None) -> None:
        if source not in SOURCE_MODELS:
            raise ValueError(f"Unknown snapshot source '{source}'")
        self.name = source
        self.model = SOURCE_MODELS[source]
        self.incoming_root = incoming_root
        self.product, self.version = PRODUCTS[source]

    def _raw_path(self, day: date) -> Path:
        return (self.incoming_root or incoming_dir(self.name)) / f"{day.isoformat()}.json"

    def _snapshot_day(self, payload: dict[str, Any]) -> date:
        if self.name == "vegetation":
            return date.fromisoformat(payload["composite_end"])
        return date.fromisoformat(payload["data_date"])

    def ingest_day(
        self,
        day: date,
        root: Path | None = None,
        overwrite: bool = False,
    ) -> tuple[Path, list[str], float | None]:
        raw_path = self._raw_path(day)
        if not raw_path.exists():
            raise FileNotFoundError(
                f"No raw {self.name} snapshot at {raw_path}. A verified Earthdata reader must "
                "produce it; this pipeline does not fabricate values."
            )
        try:
            payload = json.loads(raw_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise ValueError(f"{raw_path.name} is not valid JSON: {exc}") from exc
        if not isinstance(payload, dict):
            raise ValueError(f"{raw_path.name} must contain a JSON object")
        try:
            snapshot = self.model.model_validate(payload)
        except ValidationError as exc:
            raise ValueError(f"{raw_path.name} does not match the {self.name} contract: {exc}") from exc

        snapshot_day = self._snapshot_day(payload)
        if snapshot_day != day:
            raise ValueError(
                f"{raw_path.name} describes {snapshot_day.isoformat()}, not {day.isoformat()}"
            )

        normalised = snapshot.model_dump(mode="json")
        path, _ = write_snapshot(self.name, day, normalised, root=root, overwrite=overwrite)
        raw_coverage = normalised.get("coverage_fraction")
        coverage = float(raw_coverage) if raw_coverage is not None else None
        if self.name == "vegetation":
            cells = normalised.get("cells", [])
            good = sum(1 for cell in cells if cell.get("qa_good"))
            coverage = good / len(cells) if cells else 0.0
        return path, list(normalised.get("granule_ids", [])), coverage
