#!/usr/bin/env python3
"""Emit per-paper structured review JSONs from the day's HF trending fetch.

Shape matches contracts/review.schema.json (ai_review as a structured
object with Summary, Strengths & Weaknesses, four dimension ratings, Key
Questions, Limitations, Overall Recommendation, Confidence, Ethics).
Current implementation is a stub — real LLM wiring happens later.
"""

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


def stub_ai_review() -> dict:
    return {
        "summary": "[Stub] One-paragraph summary of the paper's contributions. LaTeX like $E=mc^2$ is supported.",
        "strengths_weaknesses": "[Stub] Prose covering soundness, presentation, significance, and originality. Replace this with the real LLM output.",
        "ratings": {
            "soundness":    {"score": 3, "note": "[Stub] short justification"},
            "presentation": {"score": 3, "note": "[Stub] short justification"},
            "significance": {"score": 3, "note": "[Stub] short justification"},
            "originality":  {"score": 3, "note": "[Stub] short justification"},
        },
        "key_questions": [
            {"question": "[Stub] key question 1 — what would change the verdict?", "tag": "could raise soundness"},
        ],
        "limitations": "[Stub] Acknowledged limitations and caveats.",
        "overall_recommendation": 3,
        "confidence": 2,
        "ethics_flag": False,
        "ethics_concerns": None,
    }


def stub_highlights() -> dict:
    return {
        "why_read": "[Stub] One-line reason a reader might click in.",
        "why_doubt": "[Stub] One-line reason to stay skeptical.",
        "verdict_leaning": "mixed",
    }


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

        review = {
            "id": review_id,
            "slug": slug,
            "date": today,
            "title": paper["title"],
            "paper_url": paper["url"],
            "abstract": paper["abstract"],
            "ai_review": stub_ai_review(),
            "review_highlights": stub_highlights(),
            "updated_at": now,
        }
        if paper.get("rank") is not None:
            review["hf_rank"] = paper["rank"]
        if paper.get("categories"):
            review["arxiv_categories"] = paper["categories"]

        out_path = REVIEWS_DIR / f"{review_id}.json"
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(review, f, ensure_ascii=False, indent=2)
        print(f"  Generated {out_path.relative_to(ROOT)}")

    print(f"\nGenerated {len(papers)} reviews")
    return 0


if __name__ == "__main__":
    sys.exit(main())
