import argparse
import getpass
import json
import os
from app.content_packs.loader import validate_content


SNAPSHOT_SOURCES = ("smap", "lst", "vegetation")


def _prompt_earthdata_credentials() -> None:
    """Read missing Earthdata credentials interactively without writing them to disk."""
    if not os.environ.get("EARTHDATA_USERNAME", "").strip():
        os.environ["EARTHDATA_USERNAME"] = input("NASA Earthdata username: ").strip()
    if not os.environ.get("EARTHDATA_PASSWORD", ""):
        os.environ["EARTHDATA_PASSWORD"] = getpass.getpass("NASA Earthdata password (input hidden): ")

    if not os.environ.get("EARTHDATA_USERNAME", "").strip() or not os.environ.get("EARTHDATA_PASSWORD", ""):
        raise RuntimeError("Earthdata username and password are required. No credentials were saved.")


def main() -> int:
    parser = argparse.ArgumentParser(description="Safe Field Nepal data and content utilities")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("validate-content", help="Validate source and farmer guidance JSON files")
    status_parser = subparsers.add_parser("status", help="Show the installed data snapshot state")
    status_parser.add_argument("--json", action="store_true", help="Emit machine-readable JSON")

    for name, maximum, help_text in (
        ("ingest", 30, "Install missing recent snapshot days"),
        ("backfill", 365, "Fill gaps over a longer historical window"),
    ):
        ingest_parser = subparsers.add_parser(name, help=help_text)
        ingest_parser.add_argument("--source", required=True, choices=SNAPSHOT_SOURCES)
        ingest_parser.add_argument("--days", type=int, required=True, help=f"1-{maximum}")
        ingest_parser.add_argument("--force", action="store_true", help="Replace an existing day")
        ingest_parser.add_argument("--dry-run", action="store_true", help="Report without writing")
        ingest_parser.add_argument(
            "--incoming-dir",
            default=None,
            help="Directory containing validated raw snapshots (default: backend/data/incoming/<source>)",
        )

    publish_parser = subparsers.add_parser(
        "publish-data", help="Mirror snapshots and status.json into a data-branch checkout"
    )
    publish_parser.add_argument("--data-dir", required=True, help="Checked-out data branch path")
    publish_parser.add_argument("--max-bytes", type=int, default=None)
    publish_parser.add_argument("--dry-run", action="store_true")

    fetch_parser = subparsers.add_parser("fetch-imerg", help="Download and cache the latest available GPM IMERG Late daily granule(s)")
    fetch_parser.add_argument(
        "--days",
        type=int,
        default=1,
        help="Number of latest available daily granules to install (1-30; default: 1)",
    )
    args = parser.parse_args()

    if args.command == "status":
        from app.ingest.shared import build_status_entries, read_status_payload

        try:
            payload = read_status_payload()
        except ValueError as exc:
            print(json.dumps({"status": "error", "message": str(exc)}, indent=2))
            return 1
        payload["installed"] = build_status_entries(SNAPSHOT_SOURCES)
        if args.json:
            print(json.dumps(payload, indent=2, ensure_ascii=False, default=str))
        else:
            state = payload.get("status", "unknown")
            print(f"Data status: {state}")
            for source, entry in payload["installed"].items():
                latest = entry["latest_data_date"] or "no snapshots installed"
                print(f"  {source}: {latest} ({len(entry['files'])} file(s))")
            for source, entry in (payload.get("sources") or {}).items():
                print(f"  reported {source}: {entry.get('status')} (latest {entry.get('latest_data_date')})")
        return 0

    if args.command in {"ingest", "backfill"}:
        from app.ingest.raw import RawSnapshotAdapter
        from app.ingest.runner import run_ingest

        maximum = 30 if args.command == "ingest" else 365
        if not 1 <= args.days <= maximum:
            parser.error(f"--days must be between 1 and {maximum}")
        from pathlib import Path

        adapter = RawSnapshotAdapter(
            args.source,
            incoming_root=Path(args.incoming_dir) if args.incoming_dir else None,
        )
        report = run_ingest(
            args.days,
            adapter=adapter,
            force=args.force,
            dry_run=args.dry_run,
        )
        print(json.dumps(report.model_dump(mode="json"), indent=2, ensure_ascii=False))
        return 0 if report.status.startswith("ok") or report.status == "dry_run" else 1

    if args.command == "publish-data":
        from pathlib import Path

        from app.ingest.publish import publish_data

        result = publish_data(
            Path(args.data_dir),
            max_bytes=args.max_bytes,
            dry_run=args.dry_run,
        )
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return 0

    if args.command == "fetch-imerg":
        if not 1 <= args.days <= 30:
            parser.error("--days must be between 1 and 30")
        _prompt_earthdata_credentials()
        from app.services.imerg.fetch_daily import fetch_imerg
        result = fetch_imerg(days=args.days)
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return 0

    if args.command == "validate-content":
        report = validate_content()
        print(json.dumps({key: value for key, value in report.items() if key not in {"fertilizer", "remedies", "conversions_data"}}, indent=2, ensure_ascii=False))
        return 0 if report["status"] == "ok" and not any(report["skipped"].values()) else 1
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
