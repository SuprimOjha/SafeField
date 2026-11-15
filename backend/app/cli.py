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
        raise RuntimeError(
            "Earthdata username and password are required. Set them in backend/.env "
            "(or repository-root .env); no credentials were saved."
        )


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

    refresh_parser = subparsers.add_parser(
        "refresh-data",
        help="Install the latest IMERG days and delete data outside retention windows",
    )
    refresh_parser.add_argument("--days", type=int, default=None, help="Days to check for new IMERG data (default: IMERG_REFRESH_DAYS)")
    refresh_parser.add_argument("--imerg-retention-days", type=int, default=None)
    refresh_parser.add_argument("--signal-retention-days", type=int, default=None)
    refresh_parser.add_argument("--api-cache-retention-days", type=int, default=None)
    refresh_parser.add_argument("--no-prune", action="store_true", help="Install new data without deleting old data")

    automation_parser = subparsers.add_parser("automation-status", help="Show the last automatic data refresh result")
    automation_parser.add_argument("--json", action="store_true", help="Emit machine-readable JSON")

    storage_sync_parser = subparsers.add_parser(
        "storage-sync", help="Upload installed snapshots and raw files to Supabase Storage"
    )
    storage_sync_parser.add_argument("--force", action="store_true", help="Upload every file even if the remote size matches")

    subparsers.add_parser(
        "storage-restore", help="Download snapshot and staged JSON files missing from local disk"
    )
    subparsers.add_parser(
        "storage-check",
        help="Create/verify the Supabase tables and bucket, then print a redacted status",
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

    if args.command == "refresh-data":
        from app.ingest.automation import run_data_refresh

        report = run_data_refresh(
            trigger="cli",
            days=args.days,
            imerg_retention_days=args.imerg_retention_days,
            signal_retention_days=args.signal_retention_days,
            api_cache_retention_days=args.api_cache_retention_days,
            prune=not args.no_prune,
        )
        print(json.dumps(report.model_dump(mode="json"), indent=2, ensure_ascii=False))
        return 0 if report.status == "ok" else 1

    if args.command == "automation-status":
        from app.ingest.automation import read_automation_status

        try:
            payload = read_automation_status()
        except ValueError as exc:
            print(json.dumps({"status": "error", "message": str(exc)}, indent=2))
            return 1
        if payload is None:
            print(json.dumps({"status": "not_run"}, indent=2))
            return 0
        if args.json:
            print(json.dumps(payload, indent=2, ensure_ascii=False, default=str))
        else:
            print(f"Automatic data refresh: {payload.get('status', 'unknown')}")
            print(f"  last run: {payload.get('finished_at') or payload.get('started_at')}")
            print(f"  {payload.get('message', '')}")
            imerg = payload.get("imerg") or {}
            prune = payload.get("prune") or {}
            print(f"  installed IMERG days: {', '.join(imerg.get('installed_dates') or []) or 'none'}")
            print(
                "  pruned: "
                f"{prune.get('imerg_days', 0)} IMERG day(s), "
                f"{prune.get('api_cache_entries', 0)} API cache entr(ies), "
                f"{prune.get('signal_snapshots', 0)} snapshot(s), "
                f"{prune.get('incoming_files', 0)} incoming file(s), "
                f"{prune.get('imerg_raw_files', 0)} raw granule(s)"
            )
            storage = payload.get("storage") or {}
            print(
                "  Supabase Storage: "
                f"{storage.get('status', 'skipped')} "
                f"(uploaded {storage.get('uploaded_files', 0)}, "
                f"removed {storage.get('deleted_files', 0)})"
            )
            if storage.get("error"):
                print(f"  storage error: {storage['error']}")
        return 0

    if args.command == "fetch-imerg":
        if not 1 <= args.days <= 30:
            parser.error("--days must be between 1 and 30")
        _prompt_earthdata_credentials()
        from app.services.imerg.fetch_daily import fetch_imerg
        result = fetch_imerg(days=args.days)
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return 0

    if args.command == "storage-sync":
        from dataclasses import asdict

        from app.config import get_settings
        from app.storage.sync import get_storage, sync_up

        if get_storage(get_settings()) is None:
            print(
                json.dumps(
                    {
                        "status": "skipped",
                        "message": "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in backend/.env first.",
                    },
                    indent=2,
                )
            )
            return 1
        report = sync_up(force=args.force)
        print(json.dumps(asdict(report), indent=2, ensure_ascii=False))
        return 0 if report.status == "ok" else 1

    if args.command == "storage-restore":
        from dataclasses import asdict

        from app.config import get_settings
        from app.storage.sync import get_storage, restore_down

        if get_storage(get_settings()) is None:
            print(
                json.dumps(
                    {
                        "status": "skipped",
                        "message": "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in backend/.env first.",
                    },
                    indent=2,
                )
            )
            return 1
        report = restore_down()
        print(json.dumps(asdict(report), indent=2, ensure_ascii=False))
        return 0 if report.status == "ok" else 1

    if args.command == "storage-check":
        from app.storage.bootstrap import initialize_data_storage

        report = initialize_data_storage(restore=False)
        print(json.dumps(report.model_dump(), indent=2, ensure_ascii=False))
        failed = "error" in (report.postgres, report.storage)
        return 1 if failed else 0

    if args.command == "validate-content":
        report = validate_content()
        print(json.dumps({key: value for key, value in report.items() if key not in {"fertilizer", "remedies", "conversions_data"}}, indent=2, ensure_ascii=False))
        return 0 if report["status"] == "ok" and not any(report["skipped"].values()) else 1
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
