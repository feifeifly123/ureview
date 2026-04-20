#!/usr/bin/env python3
"""Emit per-paper structured review JSONs from fetched trending papers.

One review per arXiv paper, forever. If the paper has already been
reviewed (matching by arXiv ID extracted from paper_url), the entry
is skipped unless --force is passed. See
product_manager/philosophy_2026-04-20.md §4 for the rule.

Shape matches contracts/review.schema.json (ai_review as a structured
object with Summary, Strengths & Weaknesses, four dimension ratings,
Key Questions, Limitations, Overall Recommendation, Confidence, Ethics).
Current implementation is a stub — real LLM wiring happens later.
"""

import argparse
import json
import re
import sys
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw"
REVIEWS_DIR = ROOT / "data" / "reviews"

ARXIV_ID_RE = re.compile(r"arxiv\.org/abs/([^/?#]+)", re.IGNORECASE)


def slugify(title: str) -> str:
    s = title.lower().strip()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")[:60]


def extract_arxiv_id(url: str) -> str | None:
    m = ARXIV_ID_RE.search(url or "")
    if not m:
        return None
    # Normalize: arXiv IDs come in old (cs/9812020) and new (2001.08361) forms;
    # strip any trailing version suffix (v1, v2) so 2001.08361 and 2001.08361v3
    # dedup to the same paper.
    aid = m.group(1).strip()
    aid = re.sub(r"v\d+$", "", aid)
    return aid or None


def load_reviewed_arxiv_ids() -> set[str]:
    """Scan every existing data/reviews/*.json and return the set of
    arXiv IDs we've already written a review for."""
    seen: set[str] = set()
    if not REVIEWS_DIR.exists():
        return seen
    for f in sorted(REVIEWS_DIR.glob("*.json")):
        try:
            with open(f, encoding="utf-8") as fh:
                data = json.load(fh)
        except (OSError, json.JSONDecodeError):
            continue
        aid = extract_arxiv_id(data.get("paper_url", ""))
        if aid:
            seen.add(aid)
    return seen


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


def pick_raw_source(args: argparse.Namespace) -> Path | None:
    """Resolve the raw input file. Explicit --input takes precedence;
    otherwise fall back to the newest trending-*.json in data/raw/, then
    (legacy) to data/raw/{today}.json."""
    if args.input:
        p = Path(args.input)
        return p if p.exists() else None
    if not RAW_DIR.exists():
        return None
    trending = sorted(RAW_DIR.glob("trending-*.json"), reverse=True)
    if trending:
        return trending[0]
    legacy = RAW_DIR / f"{date.today().isoformat()}.json"
    return legacy if legacy.exists() else None


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate per-paper review JSONs")
    parser.add_argument(
        "--input",
        help="Raw papers file (default: newest data/raw/trending-*.json)",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-review papers even if we already have a review for them.",
    )
    args = parser.parse_args()

    raw_path = pick_raw_source(args)
    if raw_path is None:
        print("No raw paper file found. Run tools/fetch_hf.py first.")
        return 1

    with open(raw_path, encoding="utf-8") as f:
        papers = json.load(f)

    if not papers:
        print(f"{raw_path.relative_to(ROOT)} is empty — nothing to review.")
        return 0

    seen = set() if args.force else load_reviewed_arxiv_ids()
    REVIEWS_DIR.mkdir(parents=True, exist_ok=True)
    today = date.today().isoformat()
    now = datetime.now(timezone.utc).isoformat()

    written = skipped = 0
    for paper in papers:
        aid = extract_arxiv_id(paper.get("url", ""))
        if aid and aid in seen:
            print(f"  skipped {aid}: already reviewed ({paper.get('title', '?')[:60]})")
            skipped += 1
            continue

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
        print(f"  generated {out_path.relative_to(ROOT)}")
        if aid:
            seen.add(aid)
        written += 1

    print(f"\nDone: {written} written, {skipped} skipped (already reviewed).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
