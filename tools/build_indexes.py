#!/usr/bin/env python3
"""Rebuild latest.json from data/reviews/*.json for the math-paper site.

Each feed entry carries enough to render a listing card without fetching
the per-paper JSON: id, title, authors, categories, date, and a one-
sentence "lede" extracted from the start of ai_proof_review.
"""

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
REVIEWS_DIR = DATA / "reviews"

LEDE_MAX_CHARS = 240


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


IMPACT_NUMERIC = {"max": 9, "high": 7, "medium": 5, "low": 3, "minimal": 1}
CORRECT_NUMERIC = {"max": 0.95, "high": 0.80, "medium": 0.55, "low": 0.25, "minimal": 0.05}


def expected_impact(review: dict[str, Any]) -> float:
    """impact-numeric × correctness-numeric — headline ranking score."""
    imp = review.get("impact_if_true", "minimal")
    corr = review.get("proof_correctness", "minimal")
    return IMPACT_NUMERIC.get(imp, 1) * CORRECT_NUMERIC.get(corr, 0.05)


def sort_key(review: dict[str, Any]) -> tuple[float, datetime]:
    """Primary: expected impact desc. Secondary: most recently updated."""
    updated = review.get("updated_at") or f"{review['date']}T00:00:00Z"
    return (expected_impact(review), parse_iso(updated))


def extract_lede(text: str) -> str:
    """First paragraph or sentence of ai_proof_review, stripped of
    markdown headers + emphasis markers, truncated to LEDE_MAX_CHARS."""
    if not text:
        return ""
    # Drop leading markdown headers and pull the first non-blank paragraph.
    for block in re.split(r"\n\s*\n", text.strip()):
        block = block.strip()
        if not block or block.startswith("#"):
            continue
        # Strip basic markdown emphasis so listings read as plain prose.
        plain = re.sub(r"[*_`]+", "", block)
        plain = " ".join(plain.split())
        if len(plain) > LEDE_MAX_CHARS:
            plain = plain[: LEDE_MAX_CHARS - 1].rstrip() + "…"
        return plain
    return ""


def build_feed_entry(review: dict[str, Any]) -> dict[str, Any]:
    entry: dict[str, Any] = {
        "id": review["id"],
        "date": review["date"],
        "title": review["title"],
        "authors": review.get("authors") or [],
        "arxiv_categories": review.get("arxiv_categories") or [],
        "review_lede": extract_lede(review.get("ai_proof_review", "")),
        "impact_if_true": review["impact_if_true"],
        "proof_correctness": review["proof_correctness"],
    }
    if review.get("published"):
        entry["published"] = review["published"]
    if review.get("updated_at"):
        entry["updated_at"] = review["updated_at"]
    return entry


def main() -> int:
    reviews: list[dict[str, Any]] = []
    if REVIEWS_DIR.exists():
        # rglob picks up both flat ids (2401.12345.json) and old-style subdir
        # layouts (math/0211159.json).
        for f in sorted(REVIEWS_DIR.rglob("*.json")):
            reviews.append(load_json(f))

    reviews.sort(key=sort_key, reverse=True)

    latest = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "reviews": [build_feed_entry(r) for r in reviews[:50]],
    }
    write_json(DATA / "latest.json", latest)

    print(f"\nIndex generation complete: {len(reviews)} reviews")
    return 0


if __name__ == "__main__":
    sys.exit(main())
