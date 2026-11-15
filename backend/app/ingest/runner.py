from datetime import date
from pathlib import Path
from typing import Protocol

from app.ingest.shared import (
    DEFAULT_KEEP_DAYS,
    IngestReport,
    latest_snapshot_date,
    prune_snapshots,
    snapshot_files,
    update_source_status,
    walk_back_days,
)


class SourceAdapter(Protocol):
    name: str
    product: str
    version: str

    def ingest_day(
        self,
        day: date,
        root: Path | None = None,
        overwrite: bool = False,
    ) -> tuple[Path, list[str], float | None]:
        """Install one day and return (snapshot_path, granule_ids, coverage)."""


def _installed_days(source: str, root: Path | None) -> set[date]:
    days: set[date] = set()
    for name in snapshot_files(source, root):
        try:
            days.add(date.fromisoformat(name.removesuffix(".json")))
        except ValueError:
            continue
    return days


def run_ingest(
    days: int,
    *,
    adapter: SourceAdapter,
    today: date | None = None,
    root: Path | None = None,
    force: bool = False,
    dry_run: bool = False,
    prune_keep: int = DEFAULT_KEEP_DAYS,
) -> IngestReport:
    """Install missing days, skipping existing snapshots so reruns are safe."""
    targets = walk_back_days(days, today)
    if dry_run:
        installed = _installed_days(adapter.name, root)
        return IngestReport(
            source=adapter.name,
            requested_days=targets,
            written=[],
            skipped=[day for day in targets if day in installed],
            failed={},
            status="dry_run",
        )

    installed = _installed_days(adapter.name, root)
    written: list[date] = []
    skipped: list[date] = []
    failed: dict[str, str] = {}

    for day in targets:
        if day in installed and not force:
            skipped.append(day)
            continue
        try:
            _, granules, coverage = adapter.ingest_day(day, root=root, overwrite=force)
        except Exception as exc:  # the report records each day's real failure
            failed[day.isoformat()] = str(exc)
            continue
        written.append(day)
        update_source_status(
            adapter.name,
            state="ok",
            latest_data_date=latest_snapshot_date(adapter.name, root) or day,
            product=adapter.product,
            version=adapter.version,
            coverage=coverage,
            granule_ids=granules,
            root=root,
        )

    pruned: list[str] = []
    if written:
        pruned = [path.name for path in prune_snapshots(adapter.name, keep=prune_keep, root=root)]

    if failed:
        update_source_status(
            adapter.name,
            state="error",
            last_error="; ".join(f"{day}: {message}" for day, message in failed.items())[:2000],
            root=root,
        )

    status = "ok" if not failed else ("partial" if written else "error")
    report = IngestReport(
        source=adapter.name,
        requested_days=targets,
        written=written,
        skipped=skipped,
        failed=failed,
        status=status,
    )
    if pruned:
        report = report.model_copy(
            update={"status": f"{status} (pruned {len(pruned)} old snapshot(s))"}
        )
    return report
