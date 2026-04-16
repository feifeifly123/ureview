#!/usr/bin/env python3
"""Generate HMAC-signed author invite magic link.

Usage:
    MAGIC_LINK_SECRET=your-secret \
    AUTHOR_BASE_URL=http://127.0.0.1:8787 \
    python3 tools/create_author_invite.py \
        --paper-id 2026-04-09-paper-a \
        --expiry-days 14
"""

import argparse
import base64
import hashlib
import hmac
import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"


def b64url_encode(data: bytes) -> str:
    """Base64url encode without padding."""
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate author invite magic link")
    parser.add_argument("--paper-id", required=True, help="Paper ID (e.g. 2026-04-09-paper-a)")
    parser.add_argument("--expiry-days", type=int, default=14, help="Link expiry in days (default 14)")
    args = parser.parse_args()

    secret = os.environ.get("MAGIC_LINK_SECRET")
    if not secret:
        print("Error: missing MAGIC_LINK_SECRET environment variable")
        return 1

    base_url = os.environ.get("AUTHOR_BASE_URL", "http://127.0.0.1:8787")

    # Verify review file exists
    review_path = DATA / "reviews" / f"{args.paper_id}.json"
    if not review_path.exists():
        print(f"Error: review file not found: {review_path.relative_to(ROOT)}")
        return 1

    # Build payload
    payload = {
        "pid": args.paper_id,
        "exp": int(time.time()) + args.expiry_days * 86400,
    }
    payload_bytes = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    payload_b64 = b64url_encode(payload_bytes)

    # HMAC-SHA256 signature, truncated to 16 bytes
    sig = hmac.new(secret.encode("utf-8"), payload_b64.encode("ascii"), hashlib.sha256).digest()[:16]
    sig_b64 = b64url_encode(sig)

    token = f"{payload_b64}.{sig_b64}"
    url = f"{base_url}/i/{token}"

    print(f"Paper:   {args.paper_id}")
    print(f"Expires: {args.expiry_days} days")
    print(f"\nInvite URL:\n{url}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
