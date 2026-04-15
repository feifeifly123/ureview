#!/usr/bin/env python3
"""Rebuild latest.json and daily/*.json indexes from data/reviews/*.json."""

import json
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
REVIEWS_DIR = DATA / "reviews"
DAILY_DIR = DATA / "daily"


def load_json(path: Path) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def write_json(path: Path, obj: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
    print(f"  Wrote {path.relative_to(ROOT)}")


def main() -> int:
    if not REVIEWS_DIR.exists():
        print("data/reviews/ directory does not exist")
        return 1

    reviews = []
    for f in sorted(REVIEWS_DIR.glob("*.json")):
        reviews.append(load_json(f))

    if not reviews:
        print("No review files found")
        return 1

    # Scan responses directory for responded paper IDs
    responses_dir = DATA / "responses"
    response_ids: set[str] = set()
    if responses_dir.exists():
        for f in responses_dir.glob("*.json"):
            response_ids.add(f.stem)

    # Group by date
    by_date: dict[str, list[dict]] = defaultdict(list)
    for r in reviews:
        by_date[r["date"]].append(r)

    # Generate daily/*.json
    DAILY_DIR.mkdir(parents=True, exist_ok=True)
    for date, items in sorted(by_date.items()):
        daily = {
            "date": date,
            "reviews": [
                {
                    "id": r["id"],
                    "title": r["title"],
                    "summary": r["summary"],
                    "score": r["review"]["score"],
                    **({"hf_rank": r["hf_rank"]} if "hf_rank" in r else {}),
                    **({"has_response": True} if r["id"] in response_ids else {}),
                }
                for r in items
            ],
        }
        write_json(DAILY_DIR / f"{date}.json", daily)

    # Generate latest.json (newest 50, sorted by updated_at desc)
    reviews.sort(key=lambda r: r["updated_at"], reverse=True)
    latest = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "reviews": [
            {
                "id": r["id"],
                "date": r["date"],
                "title": r["title"],
                "summary": r["summary"],
                "score": r["review"]["score"],
                **({"has_response": True} if r["id"] in response_ids else {}),
            }
            for r in reviews[:50]
        ],
    }
    write_json(DATA / "latest.json", latest)

    print(f"\nIndex generation complete: {len(reviews)} reviews, {len(by_date)} days")
    return 0


if __name__ == "__main__":
    sys.exit(main())
