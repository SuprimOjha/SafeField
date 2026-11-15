import hashlib
import json
import os
import tempfile
from pathlib import Path

from app.signals.models import DataStatusFile


def status_path() -> Path:
    override = os.environ.get("SAFEFIELD_STATUS_PATH", "").strip()
    if override:
        return Path(override)
    return Path(__file__).resolve().parents[2] / "data" / "status.json"


def write_status(status: DataStatusFile, path: Path | None = None) -> Path:
    """Write status.json atomically so readers never see a partial file."""
    target = path or status_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(status.model_dump(mode="json"), indent=2, ensure_ascii=False, sort_keys=True)
    with tempfile.NamedTemporaryFile(
        "w",
        encoding="utf-8",
        dir=target.parent,
        prefix=target.name + ".",
        suffix=".tmp",
        delete=False,
    ) as handle:
        handle.write(payload)
        handle.write("\n")
        temporary = Path(handle.name)
    try:
        os.replace(temporary, target)
    except OSError:
        temporary.unlink(missing_ok=True)
        raise
    return target


def read_status(path: Path | None = None) -> DataStatusFile | None:
    target = path or status_path()
    if not target.exists():
        return None
    try:
        raw = json.loads(target.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"status.json is not valid JSON: {exc}") from exc
    return DataStatusFile.model_validate(raw)


def status_etag(path: Path | None = None) -> str | None:
    target = path or status_path()
    if not target.exists():
        return None
    digest = hashlib.sha256(target.read_bytes()).hexdigest()
    return f'"{digest}"'
