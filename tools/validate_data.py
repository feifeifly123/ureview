#!/usr/bin/env python3
"""Validate JSON files under data/ against contracts/ schemas.

Modes:
    python3 tools/validate_data.py                    # full sweep
    python3 tools/validate_data.py --single PATH      # just one review file
"""

import argparse
import json
import sys
from pathlib import Path

try:
    from jsonschema import validate, ValidationError, FormatChecker
except ImportError:
    print("Please install jsonschema first: pip install jsonschema")
    sys.exit(1)

ROOT = Path(__file__).resolve().parent.parent
CONTRACTS = ROOT / "contracts"
DATA = ROOT / "data"


def load_json(path: Path) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def validate_single(path: Path) -> int:
    """Validate a single review JSON against review.schema.json.

    Used by the studio server before writing a user-submitted review to disk.
    Errors go to stderr; on success we print the id on stdout so callers can
    confirm the file parses.
    """
    schema = load_json(CONTRACTS / "review.schema.json")
    try:
        data = load_json(path)
    except (OSError, json.JSONDecodeError) as e:
        print(f"read/parse error: {e}", file=sys.stderr)
        return 2
    try:
        validate(instance=data, schema=schema, format_checker=FormatChecker())
    except ValidationError as e:
        # jsonschema's path tells the caller which field broke.
        loc = ".".join(str(p) for p in e.absolute_path) or "<root>"
        print(f"schema error at {loc}: {e.message}", file=sys.stderr)
        return 1
    print(data.get("id", ""))
    return 0


def validate_all() -> int:
    errors: list[str] = []

    review_schema = load_json(CONTRACTS / "review.schema.json")
    latest_schema = load_json(CONTRACTS / "latest.schema.json")
    daily_schema = load_json(CONTRACTS / "daily.schema.json")

    review_ids: set[str] = set()
    reviews_dir = DATA / "reviews"
    if reviews_dir.exists():
        for f in sorted(reviews_dir.glob("*.json")):
            data = load_json(f)
            try:
                validate(instance=data, schema=review_schema, format_checker=FormatChecker())
                review_ids.add(data["id"])
                print(f"  OK  {f.relative_to(ROOT)}")
            except ValidationError as e:
                errors.append(f"{f.relative_to(ROOT)}: {e.message}")
                print(f" FAIL {f.relative_to(ROOT)}: {e.message}")

    latest_path = DATA / "latest.json"
    if latest_path.exists():
        data = load_json(latest_path)
        try:
            validate(instance=data, schema=latest_schema, format_checker=FormatChecker())
            print(f"  OK  {latest_path.relative_to(ROOT)}")
        except ValidationError as e:
            errors.append(f"latest.json: {e.message}")
            print(f" FAIL latest.json: {e.message}")

        for entry in data.get("reviews", []):
            if entry["id"] not in review_ids:
                msg = f"latest.json references non-existent review: {entry['id']}"
                errors.append(msg)
                print(f" FAIL {msg}")

    daily_dir = DATA / "daily"
    if daily_dir.exists():
        for f in sorted(daily_dir.glob("*.json")):
            data = load_json(f)
            try:
                validate(instance=data, schema=daily_schema, format_checker=FormatChecker())
                print(f"  OK  {f.relative_to(ROOT)}")
            except ValidationError as e:
                errors.append(f"{f.relative_to(ROOT)}: {e.message}")
                print(f" FAIL {f.relative_to(ROOT)}: {e.message}")

            for entry in data.get("reviews", []):
                if entry["id"] not in review_ids:
                    msg = f"{f.name} references non-existent review: {entry['id']}"
                    errors.append(msg)
                    print(f" FAIL {msg}")

    if errors:
        print(f"\nValidation failed: {len(errors)} error(s)")
        return 1

    print("\nAll validations passed")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate data/ JSON against contracts/")
    parser.add_argument(
        "--single",
        metavar="PATH",
        help="Validate a single review JSON file (studio use).",
    )
    args = parser.parse_args()
    if args.single:
        return validate_single(Path(args.single))
    return validate_all()


if __name__ == "__main__":
    sys.exit(main())
