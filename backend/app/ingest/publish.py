import os
import shutil
from pathlib import Path

from app.ingest.shared import DEFAULT_MAX_DATA_BYTES, DataTransferError
from app.signals.snapshots import data_root
from app.signals.status import status_path


def _relative_files(root: Path) -> dict[str, Path]:
    if not root.exists():
        return {}
    return {
        path.relative_to(root).as_posix(): path
        for path in root.rglob("*.json")
        if path.is_file()
    }


def publish_data(
    target_dir: Path,
    source_root: Path | None = None,
    status_file: Path | None = None,
    max_bytes: int | None = None,
    dry_run: bool = False,
) -> dict[str, object]:
    """Mirror installed snapshots and status.json into a data-branch checkout."""
    source = source_root or data_root()
    status = status_file or status_path()
    limit = max_bytes or int(
        os.environ.get("SAFEFIELD_MAX_DATA_BYTES", str(DEFAULT_MAX_DATA_BYTES))
    )

    wanted = _relative_files(source)
    status_included = status.exists()
    predicted = sum(path.stat().st_size for path in wanted.values())
    if status_included:
        predicted += status.stat().st_size
    if predicted > limit:
        raise DataTransferError(
            f"Data to publish is {predicted} bytes, above the {limit}-byte limit. "
            "Prune snapshots before publishing."
        )

    target_signals = target_dir / "signals"
    existing = _relative_files(target_signals)
    if not wanted and existing:
        raise DataTransferError(
            "The local data directory has no installed snapshots; refusing to erase the "
            "existing data branch. Run a verified ingest before publishing."
        )
    to_copy = [name for name in wanted if name not in existing or existing[name].read_bytes() != wanted[name].read_bytes()]
    to_remove = [name for name in existing if name not in wanted]
    status_changed = True
    target_status = target_dir / "status.json"
    if status_included:
        status_changed = not target_status.exists() or target_status.read_bytes() != status.read_bytes()
    elif target_status.exists():
        status_changed = True
    else:
        status_changed = False

    if dry_run:
        return {
            "copied": sorted(to_copy),
            "removed": sorted(to_remove),
            "status_changed": status_changed,
            "size_bytes": predicted,
            "changed": bool(to_copy or to_remove or status_changed),
        }

    for name in to_remove:
        existing[name].unlink()
    for name in to_copy:
        destination = target_signals / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(wanted[name], destination)

    if status_included:
        target_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(status, target_status)
    elif target_status.exists():
        target_status.unlink()

    return {
        "copied": sorted(to_copy),
        "removed": sorted(to_remove),
        "status_changed": status_changed,
        "size_bytes": predicted,
        "changed": bool(to_copy or to_remove or status_changed),
    }
