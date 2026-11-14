import argparse
import getpass
import json
import os
from app.content_packs.loader import validate_content


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
    fetch_parser = subparsers.add_parser("fetch-imerg", help="Download and cache the latest available GPM IMERG Late daily granule(s)")
    fetch_parser.add_argument(
        "--days",
        type=int,
        default=1,
        help="Number of latest available daily granules to install (1-30; default: 1)",
    )
    args = parser.parse_args()

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
