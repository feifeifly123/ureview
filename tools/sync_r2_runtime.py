#!/usr/bin/env python3
"""Sync runtime-authored JSON data from Cloudflare R2 into local data/.

Used before `build_indexes.py` so the local rebuild sees author replies that
the Worker wrote directly to R2 (and which are not in git). Default prefix is
`responses`; use --prefix to override.
"""

import argparse
import os
import sys
from pathlib import Path

try:
    import boto3
except ImportError:
    print("Please install boto3 first: pip install boto3")
    sys.exit(1)

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"


def get_env(key: str) -> str:
    val = os.environ.get(key)
    if not val:
        print(f"Missing environment variable: {key}")
        sys.exit(1)
    return val


def make_client():
    account_id = get_env("R2_ACCOUNT_ID")
    access_key = get_env("R2_ACCESS_KEY_ID")
    secret_key = get_env("R2_SECRET_ACCESS_KEY")
    endpoint = f"https://{account_id}.r2.cloudflarestorage.com"
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name="auto",
    )


def download_prefix(s3, bucket: str, prefix: str) -> int:
    count = 0
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for item in page.get("Contents", []):
            key = item["Key"]
            if key.endswith("/"):
                continue
            rel = key[len("data/"):] if key.startswith("data/") else key
            dest = DATA / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            s3.download_file(bucket, key, str(dest))
            print(f"  Downloaded {key} -> {dest.relative_to(ROOT)}")
            count += 1
    return count


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync runtime-authored JSON from R2")
    parser.add_argument("--prefix", default="responses", help="Data prefix to sync (default: responses)")
    parser.add_argument("--stage", action="store_true", help="Use stage env label for logs")
    parser.add_argument("--prod", action="store_true", help="Use prod env label for logs")
    args = parser.parse_args()

    env = "prod" if args.prod else "stage" if args.stage else "local"
    bucket = get_env("R2_BUCKET_NAME")
    s3 = make_client()

    prefix = f"data/{args.prefix.strip('/')}"
    count = download_prefix(s3, bucket, prefix)
    print(f"\n[{env}] Sync complete: {count} object(s) from {bucket}/{prefix}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
