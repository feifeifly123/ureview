#!/usr/bin/env python3
"""Validate all JSON files under data/ against contracts/ schemas and check index reference consistency."""

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


def main() -> int:
    errors: list[str] = []

    review_schema = load_json(CONTRACTS / "review.schema.json")
    latest_schema = load_json(CONTRACTS / "latest.schema.json")
    daily_schema = load_json(CONTRACTS / "daily.schema.json")

    # Collect all review file IDs
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

    # Validate latest.json
    latest_path = DATA / "latest.json"
    if latest_path.exists():
        data = load_json(latest_path)
        try:
            validate(instance=data, schema=latest_schema, format_checker=FormatChecker())
            print(f"  OK  {latest_path.relative_to(ROOT)}")
        except ValidationError as e:
            errors.append(f"latest.json: {e.message}")
            print(f" FAIL latest.json: {e.message}")

        # Check reference consistency
        for entry in data.get("reviews", []):
            if entry["id"] not in review_ids:
                msg = f"latest.json references non-existent review: {entry['id']}"
                errors.append(msg)
                print(f" FAIL {msg}")

    # Validate daily/*.json
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


if __name__ == "__main__":
    sys.exit(main())
