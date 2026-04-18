#!/usr/bin/env python3
"""Rebuild latest.json and daily/*.json indexes from data/reviews/*.json.

latest.json is sorted by review.updated_at desc, then hf_rank asc. Daily
indexes preserve hf_rank order within a day. Each entry carries only the
arXiv passthrough needed to render home/browse cards without fetching
the full review JSON.
"""

import json
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

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


def parse_iso(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def sort_key(review: dict[str, Any]) -> tuple[datetime, int]:
    updated = review.get("updated_at") or f"{review['date']}T00:00:00Z"
    return (parse_iso(updated), -review.get("hf_rank", 10**9))


def build_latest_entry(review: dict[str, Any]) -> dict[str, Any]:
    entry: dict[str, Any] = {
        "id": review["id"],
        "date": review["date"],
        "title": review["title"],
        "abstract": review["abstract"],
    }
    if "hf_rank" in review:
        entry["hf_rank"] = review["hf_rank"]
    if review.get("updated_at"):
        entry["updated_at"] = review["updated_at"]
    return entry


def build_daily_entry(review: dict[str, Any]) -> dict[str, Any]:
    entry: dict[str, Any] = {
        "id": review["id"],
        "title": review["title"],
        "abstract": review["abstract"],
    }
    if "hf_rank" in review:
        entry["hf_rank"] = review["hf_rank"]
    return entry


def main() -> int:
    if not REVIEWS_DIR.exists():
        print("data/reviews/ directory does not exist")
        return 1

    reviews: list[dict[str, Any]] = []
    for f in sorted(REVIEWS_DIR.glob("*.json")):
        reviews.append(load_json(f))

    if not reviews:
        print("No review files found")
        return 1

    by_date: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for r in reviews:
        by_date[r["date"]].append(r)

    DAILY_DIR.mkdir(parents=True, exist_ok=True)
    for date, items in sorted(by_date.items()):
        items_sorted = sorted(items, key=lambda r: r.get("hf_rank", 10**9))
        daily = {
            "date": date,
            "reviews": [build_daily_entry(r) for r in items_sorted],
        }
        write_json(DAILY_DIR / f"{date}.json", daily)

    reviews.sort(key=sort_key, reverse=True)
    latest = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "reviews": [build_latest_entry(r) for r in reviews[:50]],
    }
    write_json(DATA / "latest.json", latest)

    print(f"\nIndex generation complete: {len(reviews)} reviews, {len(by_date)} days")
    return 0


if __name__ == "__main__":
    sys.exit(main())
