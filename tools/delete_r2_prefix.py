#!/usr/bin/env python3
"""Safely delete a key prefix from Cloudflare R2.

Three safety layers mirror tools/publish_r2.py so the two tools read and
feel the same:

  1. Allow-list of deletable prefixes — arbitrary prefixes (e.g. the whole
     bucket) are refused; only prefixes named in ALLOWED_PREFIXES pass.

  2. Diff preview — lists every key that would be deleted with its size,
     so an unexpected scope is visible before any DELETE goes out.

  3. Typed confirmation — user must type "delete" to proceed. --yes
     bypasses for CI; --dry-run prints the plan and exits.

An audit log is written to R2 at data/_delete_log/{timestamp}.json after
a successful run.
"""

from __future__ import annotations

import argparse
import datetime as dt
import getpass
import json
import os
import sys
from typing import Iterable

try:
    import boto3
except ImportError:
    print("Please install boto3 first: pip install boto3")
    sys.exit(1)

# Prefixes the tool is allowed to delete. Anything else is refused so a
# misspelled --prefix can't wipe reviews/latest/daily.
ALLOWED_PREFIXES: tuple[str, ...] = ("responses/",)


def get_env(key: str) -> str:
    val = os.environ.get(key)
    if not val:
        print(f"Missing environment variable: {key}")
        sys.exit(1)
    return val


def list_under_prefix(s3, bucket: str, prefix: str) -> list[dict]:
    out: list[dict] = []
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for item in page.get("Contents", []):
            out.append({"key": item["Key"], "size": item["Size"]})
    return out


def print_plan(env: str, prefix: str, objects: list[dict]) -> None:
    total_bytes = sum(o["size"] for o in objects)
    print()
    print("+" + "-" * 56 + "+")
    print(f"| R2 Delete Plan ({env}) prefix={prefix}".ljust(57) + "|")
    print("+" + "-" * 56 + "+")
    for item in objects:
        print(f"| DELETE    {item['key']}".ljust(57) + "|")
    print("+" + "-" * 56 + "+")
    print(f"| {len(objects)} objects, {total_bytes} bytes".ljust(57) + "|")
    print("+" + "-" * 56 + "+")
    print()


def require_confirmation(count: int, yes: bool) -> bool:
    if yes or os.environ.get("REFRESH_YES") == "1":
        print("Confirmation bypassed (--yes / REFRESH_YES=1).")
        return True
    if count == 0:
        print("Nothing to delete.")
        return True
    try:
        reply = input("Type \"delete\" to confirm: ").strip()
    except EOFError:
        reply = ""
    return reply == "delete"


def delete_keys(s3, bucket: str, keys: Iterable[str]) -> int:
    batch: list[dict] = []
    count = 0
    for key in keys:
        batch.append({"Key": key})
        if len(batch) >= 1000:
            s3.delete_objects(Bucket=bucket, Delete={"Objects": batch, "Quiet": True})
            count += len(batch)
            batch = []
    if batch:
        s3.delete_objects(Bucket=bucket, Delete={"Objects": batch, "Quiet": True})
        count += len(batch)
    return count


def write_audit_log(s3, bucket: str, env: str, prefix: str, deleted: list[dict]) -> None:
    now = dt.datetime.now(dt.timezone.utc)
    ts = now.strftime("%Y%m%dT%H%M%SZ")
    log = {
        "who": os.environ.get("USER") or getpass.getuser(),
        "when": now.isoformat(),
        "env": env,
        "prefix": prefix,
        "deleted": [o["key"] for o in deleted],
        "bytes_freed": sum(o["size"] for o in deleted),
    }
    body = json.dumps(log, ensure_ascii=False, indent=2).encode("utf-8")
    key = f"data/_delete_log/{ts}.json"
    s3.put_object(
        Bucket=bucket,
        Key=key,
        Body=body,
        ContentType="application/json",
        CacheControl="public, max-age=60",
    )
    print(f"  Audit log: {key}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Safely delete an R2 key prefix")
    parser.add_argument("--stage", action="store_true")
    parser.add_argument("--prod", action="store_true")
    parser.add_argument("--prefix", required=True, help="Prefix under data/ to delete (e.g. responses/)")
    parser.add_argument("--yes", action="store_true", help="Skip interactive confirmation")
    parser.add_argument("--dry-run", action="store_true", help="Show plan and exit without deleting")
    args = parser.parse_args()

    if not (args.stage or args.prod):
        print("Usage: delete_r2_prefix.py --stage|--prod --prefix <name>/ [--yes] [--dry-run]")
        return 1
    env = "prod" if args.prod else "stage"

    prefix = args.prefix
    if not prefix.endswith("/"):
        prefix += "/"
    if prefix not in ALLOWED_PREFIXES:
        print(f"Refusing: prefix '{prefix}' is not in ALLOWED_PREFIXES {ALLOWED_PREFIXES}.")
        print("Edit the allow-list in tools/delete_r2_prefix.py if you really mean it.")
        return 2
    r2_prefix = f"data/{prefix}"

    account_id = get_env("R2_ACCOUNT_ID")
    access_key = get_env("R2_ACCESS_KEY_ID")
    secret_key = get_env("R2_SECRET_ACCESS_KEY")
    bucket = get_env("R2_BUCKET_NAME")

    endpoint = f"https://{account_id}.r2.cloudflarestorage.com"
    s3 = boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name="auto",
    )

    print(f"Fetching R2 state for prefix {r2_prefix} in bucket {bucket}…")
    objects = list_under_prefix(s3, bucket, r2_prefix)

    print_plan(env, r2_prefix, objects)

    if args.dry_run:
        print("Dry run — no delete performed.")
        return 0

    if not require_confirmation(len(objects), args.yes):
        print("Aborted by user.")
        return 1

    if not objects:
        return 0

    deleted_count = delete_keys(s3, bucket, (o["key"] for o in objects))
    print(f"\n[{env}] Delete complete: {deleted_count} object(s) removed from {bucket}")
    write_audit_log(s3, bucket, env, r2_prefix, objects)
    return 0


if __name__ == "__main__":
    sys.exit(main())
