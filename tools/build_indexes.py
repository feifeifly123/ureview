#!/usr/bin/env python3
"""Rebuild latest.json and daily/*.json indexes from data/reviews/*.json.

latest.json is sorted by review.updated_at desc, then hf_rank asc. Daily
indexes preserve hf_rank order within a day. Each entry carries enough
structured-review fields to render a rich feed card without fetching
the per-paper JSON.
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


def flat_ratings(review: dict[str, Any]) -> dict[str, int]:
    """Extract just the numeric scores from ai_review.ratings.

    The full review JSON stores { score, note } per dimension; indexes
    only need the score.
    """
    ai = review.get("ai_review", {}) or {}
    raw = ai.get("ratings", {}) or {}
    out: dict[str, int] = {}
    for dim in ("soundness", "presentation", "significance", "originality"):
        if dim in raw and isinstance(raw[dim], dict) and "score" in raw[dim]:
            out[dim] = int(raw[dim]["score"])
    return out


def build_feed_entry(review: dict[str, Any], include_date: bool = True) -> dict[str, Any]:
    """Shared builder for latest + daily entries. include_date controls
    whether the `date` field is copied (daily/*.json groups by date so
    entries don't repeat it)."""
    ai = review.get("ai_review", {}) or {}
    highlights = review.get("review_highlights", {}) or {}

    entry: dict[str, Any] = {
        "id": review["id"],
        "title": review["title"],
        "abstract": review["abstract"],
    }
    if include_date:
        entry["date"] = review["date"]
    if "hf_rank" in review:
        entry["hf_rank"] = review["hf_rank"]
    if "arxiv_categories" in review and review["arxiv_categories"]:
        entry["arxiv_categories"] = review["arxiv_categories"]
    if include_date and review.get("updated_at"):
        entry["updated_at"] = review["updated_at"]

    if highlights.get("why_read"):
        entry["why_read"] = highlights["why_read"]
    if highlights.get("why_doubt"):
        entry["why_doubt"] = highlights["why_doubt"]
    if highlights.get("verdict_leaning"):
        entry["verdict_leaning"] = highlights["verdict_leaning"]

    if "overall_recommendation" in ai:
        entry["overall_recommendation"] = ai["overall_recommendation"]

    ratings = flat_ratings(review)
    if ratings:
        entry["ratings"] = ratings

    if ai.get("ethics_flag"):
        entry["ethics_flag"] = True

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
            "reviews": [build_feed_entry(r, include_date=False) for r in items_sorted],
        }
        write_json(DAILY_DIR / f"{date}.json", daily)

    reviews.sort(key=sort_key, reverse=True)
    latest = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "reviews": [build_feed_entry(r, include_date=True) for r in reviews[:50]],
    }
    write_json(DATA / "latest.json", latest)

    print(f"\nIndex generation complete: {len(reviews)} reviews, {len(by_date)} days")
    return 0


if __name__ == "__main__":
    sys.exit(main())
