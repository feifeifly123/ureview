#!/usr/bin/env python3
"""Fetch HF Daily Papers from Hugging Face.

Product thesis (see PHILOSOPHY.md):
we follow HF's curated "Daily Papers" feed — ~20 papers/day hand-picked
by HF. The page at `huggingface.co/papers` ships those as server-rendered
HTML with a `data-target="DailyPapers"` mount whose `data-props` attribute
is a JSON blob containing each paper's metadata. We parse that directly —
no scraping of DOM nodes.

Usage:
    python3 tools/fetch_hf.py                       # write data/raw/daily-{ts}.json
    python3 tools/fetch_hf.py --dry-run             # preview without writing
    python3 tools/fetch_hf.py --json-stdout         # emit list to stdout (for studio)
    python3 tools/fetch_hf.py --min-rank 20         # cap the tail

The HF HTML endpoint is reachable without auth. If your network needs a
proxy, set HTTPS_PROXY before running; urllib honours it.
"""

from __future__ import annotations

import argparse
import html as html_mod
import json
import re
import sys
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

# Repo-root-relative import; tools/ is on path when run as `python3 tools/fetch_hf.py`
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _netlib import fetch_text, FetchError  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw"

HF_DAILY_URL = "https://huggingface.co/papers"
DATA_PROPS_RE = re.compile(
    r'data-target="DailyPapers"\s+data-props="(.*?)"',
    re.S,
)

# HF seems content with any browser-ish UA; keep the historical string for continuity.
HF_USER_AGENT = "Mozilla/5.0 openagent-review/studio"


def extract_papers(html: str) -> list[dict]:
    m = DATA_PROPS_RE.search(html)
    if not m:
        raise RuntimeError(
            "Could not find data-target=\"DailyPapers\" in the HF HTML. "
            "HF may have changed their layout — inspect the page source and update the selector."
        )
    raw = html_mod.unescape(m.group(1))
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"Could not parse the HF JSON payload: {e}")

    entries = data.get("dailyPapers") or []
    out: list[dict] = []
    for i, entry in enumerate(entries, start=1):
        paper = entry.get("paper") or {}
        arxiv_id = paper.get("id")
        title = paper.get("title") or entry.get("title")
        abstract = paper.get("summary") or entry.get("summary")
        if not (arxiv_id and title):
            continue
        out.append(
            {
                "title": title.strip(),
                "url": f"https://arxiv.org/abs/{arxiv_id}",
                "abstract": (abstract or "").strip(),
                "rank": i,
                "upvotes": paper.get("upvotes"),
                "arxiv_id": arxiv_id,
            }
        )
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch HF Daily Papers")
    parser.add_argument(
        "--min-rank",
        type=int,
        default=None,
        help="Keep only papers with rank <= this (skip deep tail).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would be fetched, do not write any file.",
    )
    parser.add_argument(
        "--json-stdout",
        action="store_true",
        help="Emit the parsed list to stdout as JSON; do not write a raw file.",
    )
    args = parser.parse_args()

    try:
        html = fetch_text(HF_DAILY_URL, timeout=20, user_agent=HF_USER_AGENT)
        papers = extract_papers(html)
    except (urllib.error.HTTPError, FetchError, RuntimeError) as e:
        print(f"fetch_hf: {e}", file=sys.stderr)
        return 2

    if args.min_rank is not None:
        papers = [p for p in papers if p.get("rank", 10**9) <= args.min_rank]

    if args.json_stdout:
        print(json.dumps(papers, ensure_ascii=False, indent=2))
        return 0

    now = datetime.now(timezone.utc)
    now_iso = now.isoformat(timespec="seconds").replace("+00:00", "Z")
    slug_ts = now.strftime("%Y-%m-%dT%H%M%SZ")

    if args.dry_run:
        print(f"[dry-run] Would fetch {len(papers)} daily paper(s) at {now_iso}:")
        for p in papers[:10]:
            print(f"  rank {p.get('rank', '?')}: {p['title'][:80]}  ({p['url']})")
        if len(papers) > 10:
            print(f"  …and {len(papers) - 10} more")
        return 0

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    out_path = RAW_DIR / f"daily-{slug_ts}.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(papers, f, ensure_ascii=False, indent=2)

    print(f"Saved {len(papers)} paper(s) to {out_path.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
