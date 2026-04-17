#!/usr/bin/env python3
"""Rebuild latest.json and daily/*.json indexes from data/reviews/*.json.

Key behavior:
  * latest.json is sorted by last_activity_at desc (max of review.updated_at
    and the latest thread.submitted_at from responses/), so author replies
    naturally bubble threads back to the top of the queue.
  * Each latest entry carries hf_rank / confidence / updated_at /
    last_activity_at / response_count so the front-end can render cards
    without also fetching every reviews/{id}.json.
  * Daily indexes include the same richer fields.
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
RESPONSES_DIR = DATA / "responses"
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


def max_iso(*values: str | None) -> str | None:
    valid = [v for v in values if v]
    if not valid:
        return None
    return max(valid, key=parse_iso)


def load_response_meta() -> dict[str, dict[str, Any]]:
    """For each paper id with a response file, return a summary dict:
        { paper_id: { has_response, response_count, last_activity_at } }
    """
    meta: dict[str, dict[str, Any]] = {}
    if not RESPONSES_DIR.exists():
        return meta
    for f in sorted(RESPONSES_DIR.glob("*.json")):
        data = load_json(f)
        thread = data.get("thread", [])
        times = [item.get("submitted_at") for item in thread if item.get("submitted_at")]
        meta[data["paper_id"]] = {
            "has_response": len(thread) > 0,
            "response_count": len(thread),
            "last_activity_at": max_iso(*times),
        }
    return meta


def sort_key(review: dict[str, Any], response_meta: dict[str, dict[str, Any]]) -> datetime:
    meta = response_meta.get(review["id"], {})
    last = max_iso(review.get("updated_at"), meta.get("last_activity_at"))
    if last is None:
        # Fall back to publication date so ordering stays deterministic.
        return parse_iso(f"{review['date']}T00:00:00Z")
    return parse_iso(last)


def build_latest_entry(
    review: dict[str, Any], response_meta: dict[str, dict[str, Any]]
) -> dict[str, Any]:
    meta = response_meta.get(review["id"], {})
    last_activity_at = max_iso(review.get("updated_at"), meta.get("last_activity_at"))
    entry: dict[str, Any] = {
        "id": review["id"],
        "date": review["date"],
        "title": review["title"],
        "summary": review["summary"],
        "score": review["review"]["score"],
        "has_response": bool(meta.get("has_response", False)),
        "response_count": int(meta.get("response_count", 0)),
    }
    if "hf_rank" in review:
        entry["hf_rank"] = review["hf_rank"]
    if review["review"].get("confidence") is not None:
        entry["confidence"] = review["review"]["confidence"]
    if review.get("updated_at"):
        entry["updated_at"] = review["updated_at"]
    if last_activity_at:
        entry["last_activity_at"] = last_activity_at
    return entry


def build_daily_entry(
    review: dict[str, Any], response_meta: dict[str, dict[str, Any]]
) -> dict[str, Any]:
    meta = response_meta.get(review["id"], {})
    last_activity_at = max_iso(review.get("updated_at"), meta.get("last_activity_at"))
    entry: dict[str, Any] = {
        "id": review["id"],
        "title": review["title"],
        "summary": review["summary"],
        "score": review["review"]["score"],
    }
    if "hf_rank" in review:
        entry["hf_rank"] = review["hf_rank"]
    if meta.get("has_response"):
        entry["has_response"] = True
        entry["response_count"] = int(meta["response_count"])
    if review["review"].get("confidence") is not None:
        entry["confidence"] = review["review"]["confidence"]
    if last_activity_at:
        entry["last_activity_at"] = last_activity_at
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

    response_meta = load_response_meta()

    # Daily index — group by date, sort items within a day by hf_rank asc then score desc
    by_date: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for r in reviews:
        by_date[r["date"]].append(r)

    DAILY_DIR.mkdir(parents=True, exist_ok=True)
    for date, items in sorted(by_date.items()):
        items_sorted = sorted(
            items,
            key=lambda r: (r.get("hf_rank", 10**9), -r["review"]["score"]),
        )
        daily = {
            "date": date,
            "reviews": [build_daily_entry(r, response_meta) for r in items_sorted],
        }
        write_json(DAILY_DIR / f"{date}.json", daily)

    # Latest index — top 50 by last_activity_at desc
    reviews.sort(key=lambda r: sort_key(r, response_meta), reverse=True)
    latest = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "reviews": [build_latest_entry(r, response_meta) for r in reviews[:50]],
    }
    write_json(DATA / "latest.json", latest)

    print(f"\nIndex generation complete: {len(reviews)} reviews, {len(by_date)} days")
    return 0


if __name__ == "__main__":
    sys.exit(main())
