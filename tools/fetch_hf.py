#!/usr/bin/env python3
"""Fetch trending papers from Hugging Face.

Product thesis (see product_manager/philosophy_2026-04-20.md):
this pipeline is trending-driven, not calendar-driven. "An empty fetch"
is a valid, expected outcome. Runs produce a timestamped raw file so
that multiple runs per day don't overwrite each other.

Current implementation is a stub pending real HF integration. When the
real fetch lands, it should target the trending endpoint, not the
daily endpoint (we explicitly moved away from date-anchored queues).
"""

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw"


def fetch_trending_stub(now_iso: str) -> list[dict]:
    # TODO: Replace with real HF Trending scrape / API call.
    #
    # Likely shape (subject to the real HF response):
    #     url = "https://huggingface.co/api/trending?type=paper"
    #     with urllib.request.urlopen(url, timeout=15) as r:
    #         payload = json.load(r)
    #     for i, entry in enumerate(payload, start=1):
    #         p = entry["paper"]
    #         yield {
    #             "title":    p["title"],
    #             "url":      f"https://arxiv.org/abs/{p['id']}",
    #             "abstract": p.get("summary", ""),
    #             "rank":     i,
    #         }
    #
    # Keep rank stable across a single run (so dedup decisions match
    # what's in the raw file).
    return [
        {
            "title": f"[Stub] Trending paper A ({now_iso})",
            "url": "https://arxiv.org/abs/0000.00000",
            "abstract": "Placeholder abstract.",
            "rank": 1,
        },
        {
            "title": f"[Stub] Trending paper B ({now_iso})",
            "url": "https://arxiv.org/abs/0000.00001",
            "abstract": "Another placeholder abstract.",
            "rank": 2,
        },
    ]


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch HF trending papers into data/raw/")
    parser.add_argument(
        "--min-rank",
        type=int,
        default=None,
        help="Keep only papers with rank <= this (skip deep trending tail).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would be fetched, do not write any file.",
    )
    args = parser.parse_args()

    now = datetime.now(timezone.utc)
    now_iso = now.isoformat(timespec="seconds").replace("+00:00", "Z")
    slug_ts = now.strftime("%Y-%m-%dT%H%M%SZ")

    papers = fetch_trending_stub(now_iso)
    if args.min_rank is not None:
        papers = [p for p in papers if p.get("rank", 10**9) <= args.min_rank]

    if args.dry_run:
        print(f"[dry-run] Would fetch {len(papers)} trending paper(s) at {now_iso}:")
        for p in papers:
            print(f"  rank {p.get('rank', '?')}: {p['title']}  ({p['url']})")
        return 0

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    out_path = RAW_DIR / f"trending-{slug_ts}.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(papers, f, ensure_ascii=False, indent=2)

    print(f"Saved {len(papers)} paper(s) to {out_path.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
