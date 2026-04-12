#!/usr/bin/env python3
"""生成 HMAC 签名的作者邀请 magic link。

用法:
    MAGIC_LINK_SECRET=your-secret \
    AUTHOR_BASE_URL=http://127.0.0.1:8787 \
    python3 tools/create_author_invite.py \
        --paper-id 2026-04-09-paper-a \
        --email author@example.com \
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
    parser = argparse.ArgumentParser(description="生成作者邀请 magic link")
    parser.add_argument("--paper-id", required=True, help="论文 ID (如 2026-04-09-paper-a)")
    parser.add_argument("--email", required=True, help="作者邮箱")
    parser.add_argument("--expiry-days", type=int, default=14, help="链接有效期 (天，默认 14)")
    args = parser.parse_args()

    secret = os.environ.get("MAGIC_LINK_SECRET")
    if not secret:
        print("错误: 缺少环境变量 MAGIC_LINK_SECRET")
        return 1

    base_url = os.environ.get("AUTHOR_BASE_URL", "http://127.0.0.1:8787")

    # 校验 review 文件存在
    review_path = DATA / "reviews" / f"{args.paper_id}.json"
    if not review_path.exists():
        print(f"错误: review 文件不存在: {review_path.relative_to(ROOT)}")
        return 1

    # 构建 payload
    payload = {
        "pid": args.paper_id,
        "email": args.email,
        "exp": int(time.time()) + args.expiry_days * 86400,
    }
    payload_bytes = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    payload_b64 = b64url_encode(payload_bytes)

    # HMAC-SHA256 签名，截断到 16 字节
    sig = hmac.new(secret.encode("utf-8"), payload_b64.encode("ascii"), hashlib.sha256).digest()[:16]
    sig_b64 = b64url_encode(sig)

    token = f"{payload_b64}.{sig_b64}"
    url = f"{base_url}/i/{token}"

    print(f"Paper:   {args.paper_id}")
    print(f"Email:   {args.email}")
    print(f"Expires: {args.expiry_days} days")
    print(f"\nInvite URL:\n{url}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
