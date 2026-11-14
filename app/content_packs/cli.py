import argparse
import json
from pathlib import Path
from pydantic import ValidationError
from app.content_packs.models import ContentPack


def validate_pack(path: Path) -> tuple[bool, str]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        pack = ContentPack.model_validate(raw)
    except (OSError, json.JSONDecodeError, ValidationError) as exc:
        return False, str(exc)
    return True, f"Valid {pack.status.lower()} pack '{pack.pack_id}' v{pack.version}: {len(pack.items)} guidance item(s)."


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate a Safe Field Nepal farmer guidance content pack.")
    parser.add_argument("validate", choices=["validate"], help="Validate a JSON content pack")
    parser.add_argument("path", type=Path, help="Path to the content-pack JSON file")
    args = parser.parse_args()
    valid, message = validate_pack(args.path)
    print(message)
    return 0 if valid else 1


if __name__ == "__main__":
    raise SystemExit(main())
