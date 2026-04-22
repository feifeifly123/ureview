#!/usr/bin/env python3
"""Fetch a single paper's metadata from the public arXiv API.

Usage:
    python3 tools/fetch_arxiv.py --id 2001.08361

Emits a JSON object on stdout with:
    { arxiv_id, title, abstract, paper_url, arxiv_categories, published }

Errors are printed to stderr and the process exits non-zero so the
studio server can distinguish success from failure.

Networking note: urllib honours HTTP_PROXY / HTTPS_PROXY but does NOT
speak SOCKS. If the environment has ALL_PROXY set to a SOCKS URL (or
HTTPS_PROXY accidentally set to a socks5:// URL, which is a common
misconfiguration in containers that only egress via SOCKS), urllib will
fail with "Remote end closed connection without response" — the proxy
doesn't understand HTTP framing. We mirror fetch_hf.py's strategy:
fall back to curl (which speaks both HTTP and SOCKS) when urllib fails.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET

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


def fetch_xml(url: str) -> bytes:
    """Fetch the arXiv Atom feed, falling back to curl if urllib fails."""
    headers = {"User-Agent": "openagent-review/studio"}
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.read()
    except (urllib.error.URLError, ConnectionResetError) as urllib_err:
        if not shutil.which("curl"):
            raise RuntimeError(
                f"urllib failed ({urllib_err}) and curl is not on PATH to fall back to."
            )
        cmd = ["curl", "-sSL", "--max-time", "30", "-A", headers["User-Agent"]]
        # curl reads ALL_PROXY/HTTPS_PROXY itself, but being explicit is safer
        # when HTTPS_PROXY is set to a SOCKS URL (urllib would choke, curl handles it).
        proxy = os.environ.get("ALL_PROXY") or os.environ.get("all_proxy")
        if proxy:
            cmd.extend(["--proxy", proxy])
        cmd.append(url)
        try:
            out = subprocess.run(cmd, capture_output=True, check=True, timeout=45)
        except subprocess.CalledProcessError as curl_err:
            raise RuntimeError(
                f"curl fallback failed (exit {curl_err.returncode}): "
                f"{curl_err.stderr.decode('utf-8', 'replace').strip()}"
            )
        return out.stdout


def fetch(arxiv_id: str) -> dict:
    canonical = normalize_id(arxiv_id)
    url = f"https://export.arxiv.org/api/query?id_list={canonical}"
    raw = fetch_xml(url)

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
        data = fetch(args.id)
    except urllib.error.HTTPError as e:
        print(f"arXiv HTTP {e.code}: {e.reason}", file=sys.stderr)
        return 2
    except urllib.error.URLError as e:
        print(f"arXiv network error: {e.reason}", file=sys.stderr)
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
