import json
import re
from pathlib import Path
from typing import Any
from pydantic import ValidationError
from app.content_packs.models import (
    AreaConversion, FertilizerReference, HomeRemedy, SourceRecord,
)

CONTENT_DIR = Path(__file__).resolve().parents[2] / "content"
DOSE_PATTERN = re.compile(
    r"\b\d+(?:[.,]\d+)?\s*(?:mg|g|kg|ml|mL|l|L|%|ppm|spoon|cup|litre|liter|ropani|bigha|kattha)\b"
    r"|\bper\s+hectare\b|\bkg\s*/\s*ha\b|\bg\s*/\s*l\b",
    re.IGNORECASE,
)


def _read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def validate_content(content_dir: Path = CONTENT_DIR) -> dict[str, Any]:
    """Load verified records only; invalid records are skipped and counted."""
    report: dict[str, Any] = {
        "status": "ok", "sources": 0, "fertilizer_references": 0,
        "conversions": 0, "home_remedies": 0, "skipped": {}, "warnings": [],
        "fertilizer": [], "remedies": [], "conversions_data": [], "source_records": {},
    }
    try:
        raw_sources = _read_json(content_dir / "sources.json")
    except (OSError, json.JSONDecodeError) as exc:
        return {**report, "status": "error", "error": f"sources.json: {exc}"}

    if not isinstance(raw_sources, dict):
        return {**report, "status": "error", "error": "sources.json must be a JSON object keyed by sourceKey"}

    sources: dict[str, SourceRecord] = {}
    for key, raw in raw_sources.items():
        if key == "_example":
            continue
        try:
            source = SourceRecord.model_validate(raw)
            sources[key] = source
        except ValidationError as exc:
            report["warnings"].append(f"sources.{key}: {exc.errors()[0]['msg']}")
    report["sources"] = len(sources)
    report["source_records"] = {key: source.model_dump() for key, source in sources.items()}
    if report["warnings"]:
        report["status"] = "partial"

    def load_records(filename: str, model: type, kind: str):
        try:
            raw = _read_json(content_dir / filename)
            records = raw.get("records", [])
            if not isinstance(records, list):
                raise ValueError("records must be an array")
        except (OSError, json.JSONDecodeError, ValueError) as exc:
            report["status"] = "partial"
            report["warnings"].append(f"{filename}: {exc}")
            return []
        valid = []
        skipped = 0
        for index, item in enumerate(records):
            try:
                record = model.model_validate(item)
                if not record.verified:
                    raise ValueError("verified must be true")
                if record.sourceKey not in sources:
                    raise ValueError(f"unknown sourceKey: {record.sourceKey}")
                source = sources[record.sourceKey]
                if kind == "fertilizer":
                    if not source.official:
                        raise ValueError("fertilizer references require an official source")
                    if record.valueMin is None and record.valueMax is None:
                        raise ValueError("at least one printed reference bound is required")
                    if record.valueMin is not None and record.valueMax is not None and record.valueMin > record.valueMax:
                        raise ValueError("valueMin cannot exceed valueMax")
                    if len(record.shortQuote.split()) > 25:
                        raise ValueError("shortQuote must be no more than 25 words")
                    if not record.unitAsPrinted.strip():
                        raise ValueError("unitAsPrinted is required exactly as printed")
                elif kind == "conversion":
                    if not record.toHectare or record.toHectare <= 0:
                        raise ValueError("verified conversion requires a positive toHectare value")
                elif kind == "remedy":
                    free_text = " ".join([record.remedyText, record.preparationNotesAsPrinted or "", record.safetyNotes])
                    if DOSE_PATTERN.search(free_text):
                        raise ValueError("dose-like quantity must be stored only in quantitiesAsPrinted")
                    if record.quantitiesAsPrinted and not source.official:
                        report["warnings"].append(f"{filename}[{index}]: quantity hidden because its source is not official")
                        record.quantitiesAsPrinted = None
                        record.preparationNotesAsPrinted = None
                valid.append(record.model_dump())
            except (ValidationError, ValueError) as exc:
                skipped += 1
                report["warnings"].append(f"{filename}[{index}] skipped: {exc}")
        report["skipped"][kind] = skipped
        if skipped:
            report["status"] = "partial"
        return valid

    report["fertilizer"] = load_records("fertilizer_reference.json", FertilizerReference, "fertilizer")
    report["conversions_data"] = load_records("conversions.json", AreaConversion, "conversion")
    report["remedies"] = load_records("home_remedies.json", HomeRemedy, "remedy")
    report["fertilizer_references"] = len(report["fertilizer"])
    report["conversions"] = len(report["conversions_data"])
    report["home_remedies"] = len(report["remedies"])
    return report
