#!/usr/bin/env python3
"""Generate AI reviews for fetched papers. (v1 stub)"""

import json
import re
import sys
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw"
REVIEWS_DIR = ROOT / "data" / "reviews"


def slugify(title: str) -> str:
    s = title.lower().strip()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")[:60]


def main() -> int:
    today = date.today().isoformat()
    raw_path = RAW_DIR / f"{today}.json"

    if not raw_path.exists():
        print(f"Raw data not found: {raw_path.relative_to(ROOT)}")
        print("Please run fetch_hf.py first")
        return 1

    with open(raw_path, encoding="utf-8") as f:
        papers = json.load(f)

    REVIEWS_DIR.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc).isoformat()

    for paper in papers:
        slug = slugify(paper["title"])
        review_id = f"{today}-{slug}"

        # TODO: Replace with real LLM API call
        review = {
            "id": review_id,
            "slug": slug,
            "date": today,
            "title": paper["title"],
            "paper_url": paper["url"],
            "hf_rank": paper.get("rank"),
            "summary": f"[Stub] {paper['abstract'][:100]}",
            "review": {
                "score": 5.0,
                "confidence": 2,
                "strengths": ["[Stub] Placeholder for real review"],
                "weaknesses": ["[Stub] Placeholder for real review"],
                "final_comment": "[Stub] This is a placeholder review. Connect to an LLM to generate real reviews.",
            },
            "updated_at": now,
        }

        out_path = REVIEWS_DIR / f"{review_id}.json"
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(review, f, ensure_ascii=False, indent=2)
        print(f"  Generated {out_path.relative_to(ROOT)}")

    print(f"\nGenerated {len(papers)} reviews")
    return 0


if __name__ == "__main__":
    sys.exit(main())
