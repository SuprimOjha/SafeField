import argparse
import json
from pathlib import Path
from app.content_packs.loader import validate_content


def main() -> int:
    parser = argparse.ArgumentParser(description="Safe Field Nepal data and content utilities")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("validate-content", help="Validate source and farmer guidance JSON files")
    args = parser.parse_args()

    if args.command == "validate-content":
        report = validate_content()
        print(json.dumps({key: value for key, value in report.items() if key not in {"fertilizer", "remedies", "conversions_data"}}, indent=2, ensure_ascii=False))
        return 0 if report["status"] == "ok" and not any(report["skipped"].values()) else 1
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
