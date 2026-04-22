#!/usr/bin/env python3
"""Fetch a single paper's metadata from the public arXiv API.

Usage:
    python3 tools/fetch_arxiv.py --id 2001.08361

Emits a JSON object on stdout with:
    { arxiv_id, title, abstract, paper_url, arxiv_categories, published }

Errors are printed to stderr and the process exits non-zero so the
studio server can distinguish success from failure.

Networking: delegates the HTTP fetch to `tools/_netlib.py`, which is
SOCKS-safe (falls back from urllib to curl when the proxy speaks SOCKS).
See PHILOSOPHY.md §6: "all outbound-network tools must be SOCKS-safe".
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import xml.etree.ElementTree as ET
from pathlib import Path

# tools/ dir on sys.path so we can import _netlib whether run as script or module
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _netlib import fetch, FetchError  # noqa: E402

ATOM_NS = {
    "atom": "http://www.w3.org/2005/Atom",
    "arxiv": "http://arxiv.org/schemas/atom",
}


def normalize_id(raw: str) -> str:
    # Accept full URLs, bare IDs with or without version suffix.
    m = re.search(r"arxiv\.org/abs/([^/?#]+)", raw, re.IGNORECASE)
    if m:
        raw = m.group(1)
    raw = raw.strip()
    # Strip version suffix: 2001.08361v2 -> 2001.08361
    return re.sub(r"v\d+$", "", raw)


def fetch_paper(arxiv_id: str) -> dict:
    canonical = normalize_id(arxiv_id)
    url = f"https://export.arxiv.org/api/query?id_list={canonical}"
    raw = fetch(url, timeout=15, user_agent="openagent-review/studio")

    root = ET.fromstring(raw)
    entry = root.find("atom:entry", ATOM_NS)
    if entry is None:
        raise RuntimeError(f"arXiv returned no entry for id={canonical}")

    title = " ".join((entry.findtext("atom:title", default="", namespaces=ATOM_NS) or "").split())
    abstract = " ".join(
        (entry.findtext("atom:summary", default="", namespaces=ATOM_NS) or "").split()
    )
    published = entry.findtext("atom:published", default="", namespaces=ATOM_NS) or None

    categories = []
    for cat in entry.findall("atom:category", ATOM_NS):
        term = cat.get("term")
        if term and term not in categories:
            categories.append(term)

    return {
        "arxiv_id": canonical,
        "title": title,
        "abstract": abstract,
        "paper_url": f"https://arxiv.org/abs/{canonical}",
        "arxiv_categories": categories,
        "published": published,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch arXiv paper metadata")
    parser.add_argument(
        "--id",
        required=True,
        help="arXiv paper ID (e.g. 2001.08361) — accepts full URL, with or without version suffix",
    )
    args = parser.parse_args()

    try:
        data = fetch_paper(args.id)
    except urllib.error.HTTPError as e:
        print(f"arXiv HTTP {e.code}: {e.reason}", file=sys.stderr)
        return 2
    except FetchError as e:
        print(f"arXiv fetch error: {e}", file=sys.stderr)
        return 2
    except RuntimeError as e:
        print(f"arXiv fetch error: {e}", file=sys.stderr)
        return 2
    except Exception as e:
        print(f"arXiv parse error: {e}", file=sys.stderr)
        return 3

    print(json.dumps(data, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
