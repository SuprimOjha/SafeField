import json
import os
import tempfile
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable

from pydantic import BaseModel

from app.signals.models import DataStatusFile, SourceStatus
from app.signals.snapshots import data_root, source_dir
from app.signals.status import read_status, write_status


DEFAULT_KEEP_DAYS = 120
DEFAULT_MAX_DATA_BYTES = 20 * 1024 * 1024


class IngestReport(BaseModel):
    source: str
    requested_days: list[date]
    written: list[date]
    skipped: list[date]
    failed: dict[str, str]
    status: str


class DataTransferError(RuntimeError):
    """A snapshot or status file cannot be safely published."""


def utc_today() -> date:
    return datetime.now(timezone.utc).date()


def walk_back_days(days: int, today: date | None = None) -> list[date]:
    """Days to install: yesterday backwards, oldest first. Today is partial."""
    if days < 1:
        return []
    current = today or utc_today()
    return [current - timedelta(days=offset) for offset in range(days, 0, -1)]


def _canonical(payload: dict) -> str:
    return json.dumps(payload, indent=2, ensure_ascii=False, sort_keys=True) + "\n"


def write_snapshot(
    source: str,
    day: date,
    payload: dict,
    root: Path | None = None,
    overwrite: bool = False,
) -> tuple[Path, bool]:
    """Write a snapshot atomically; return (path, changed).

    A byte-identical snapshot is left untouched so re-running ingest is
    idempotent and does not create empty commits on the data branch.
    """
    directory = source_dir(source, root)
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / f"{day.isoformat()}.json"
    text = _canonical(payload)
    if target.exists():
        if not overwrite and target.read_text(encoding="utf-8") == text:
            return target, False
        if not overwrite:
            # A different payload for an existing day is a pipeline change, not
            # a routine refresh. Require --force so history is not rewritten
            # silently.
            raise DataTransferError(
                f"{source}/{target.name} already exists with different content; use --force to replace it."
            )
    with tempfile.NamedTemporaryFile(
        "w",
        encoding="utf-8",
        dir=directory,
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
    return target, True


def prune_snapshots(
    source: str,
    keep: int = DEFAULT_KEEP_DAYS,
    root: Path | None = None,
) -> list[Path]:
    """Delete the oldest dated snapshots beyond the retention count."""
    if keep < 1:
        raise ValueError("keep must be at least 1")
    directory = source_dir(source, root)
    if not directory.exists():
        return []
    dated: list[tuple[date, Path]] = []
    for path in directory.glob("*.json"):
        try:
            dated.append((date.fromisoformat(path.stem), path))
        except ValueError:
            continue
    dated.sort(key=lambda item: item[0])
    removed = []
    for _, path in dated[: max(0, len(dated) - keep)]:
        path.unlink()
        removed.append(path)
    return removed


def data_size_bytes(root: Path | None = None) -> int:
    base = root or data_root()
    if not base.exists():
        return 0
    return sum(path.stat().st_size for path in base.rglob("*.json") if path.is_file())


def enforce_size_guard(
    max_bytes: int | None = None,
    root: Path | None = None,
) -> int:
    limit = max_bytes or int(
        os.environ.get("SAFEFIELD_MAX_DATA_BYTES", str(DEFAULT_MAX_DATA_BYTES))
    )
    size = data_size_bytes(root)
    if size > limit:
        raise DataTransferError(
            f"Installed data is {size} bytes, above the {limit}-byte limit. "
            "Prune old snapshots or raise SAFEFIELD_MAX_DATA_BYTES deliberately."
        )
    return size


def latest_snapshot_date(source: str, root: Path | None = None) -> date | None:
    directory = source_dir(source, root)
    if not directory.exists():
        return None
    days = []
    for path in directory.glob("*.json"):
        try:
            days.append(date.fromisoformat(path.stem))
        except ValueError:
            continue
    return max(days) if days else None


def snapshot_files(source: str, root: Path | None = None) -> list[str]:
    directory = source_dir(source, root)
    if not directory.exists():
        return []
    return sorted(path.name for path in directory.glob("*.json"))


def update_source_status(
    source: str,
    *,
    state: str,
    latest_data_date: date | None = None,
    product: str | None = None,
    version: str | None = None,
    coverage: float | None = None,
    granule_ids: Iterable[str] | None = None,
    last_error: str | None = None,
    root: Path | None = None,
) -> DataStatusFile:
    """Merge one source into status.json without dropping other sources."""
    existing = read_status()
    now = datetime.now(timezone.utc).replace(microsecond=0)
    sources = dict(existing.sources) if existing else {}
    previous = sources.get(source)
    success = state == "ok"
    entry = SourceStatus(
        source=source,
        status=state,  # type: ignore[arg-type]
        last_success_at=now if success else (previous.last_success_at if previous else None),
        latest_data_date=latest_data_date
        if latest_data_date is not None
        else (previous.latest_data_date if previous else None),
        coverage=coverage if coverage is not None else (previous.coverage if previous else None),
        version=version if version is not None else (previous.version if previous else None),
        product=product if product is not None else (previous.product if previous else None),
        granule_ids=list(granule_ids)
        if granule_ids is not None
        else (previous.granule_ids if previous else []),
        last_error=None if success else (last_error or (previous.last_error if previous else None)),
        files=snapshot_files(source, root),
    )
    sources[source] = entry
    document = DataStatusFile(generated_at=now, sources=sources)
    write_status(document)
    return document


def missing_sources(sources: Iterable[str], root: Path | None = None) -> list[str]:
    return [source for source in sources if latest_snapshot_date(source, root) is None]


def read_status_payload() -> dict[str, Any]:
    status = read_status()
    if status is None:
        return {"status": "not_installed"}
    return status.model_dump(mode="json")


def build_status_entries(sources: Iterable[str], root: Path | None = None) -> dict[str, Any]:
    entries = {}
    for source in sources:
        entries[source] = {
            "latest_data_date": latest_snapshot_date(source, root),
            "files": snapshot_files(source, root),
        }
    return entries
