#!/usr/bin/env python3
"""Safe publisher for data/ → Cloudflare R2.

Three protection layers stop a bad local state from clobbering the live
bucket:

  1. Ownership split — responses/* is Worker-owned. The publisher never
     uploads anything under that prefix, even if local copies exist.

  2. Reviews are append-only by default — if a review key already exists in
     R2 with different content, publishing aborts unless --force is given.
     New review keys upload normally.

  3. Diff preview + confirmation — the classifier prints NEW / MODIFIED /
     UNCHANGED / PROTECTED rows before any upload. User must type "publish"
     to proceed. --yes (or REFRESH_YES=1) skips the prompt for CI; --dry-run
     shows the plan without uploading.

Per-key Cache-Control is applied on upload. A small audit log is written to
R2 at data/_publish_log/{timestamp}.json after a successful run.
"""

from __future__ import annotations

import argparse
import datetime as dt
import getpass
import hashlib
import json
import os
import sys
from pathlib import Path
from typing import Iterable

try:
    import boto3
except ImportError:
    print("Please install boto3 first: pip install boto3")
    sys.exit(1)

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

# Ownership rule (Layer 1): these prefixes are writer-exclusive and the
# publisher never uploads to them.
PROTECTED_PREFIXES: tuple[str, ...] = ("responses/",)


def get_env(key: str) -> str:
    val = os.environ.get(key)
    if not val:
        print(f"Missing environment variable: {key}")
        sys.exit(1)
    return val


def cache_control_for(key: str, env: str) -> str:
    if env == "stage":
        return "public, max-age=30, stale-while-revalidate=60"
    if key == "latest.json":
        return "public, max-age=60, stale-while-revalidate=300"
    if key.startswith("responses/"):
        return "public, max-age=60, stale-while-revalidate=300"
    if key.startswith("daily/"):
        return "public, max-age=300, stale-while-revalidate=900"
    if key.startswith("reviews/"):
        return "public, max-age=31536000, immutable"
    return "public, max-age=300, stale-while-revalidate=600"


def iter_local_files() -> Iterable[Path]:
    """Yield every file under data/ excluding hidden dirs and audit logs."""
    for path in sorted(DATA.rglob("*.json")):
        rel = path.relative_to(DATA)
        # Skip audit log dir; publisher re-creates it.
        if rel.parts and rel.parts[0] == "_publish_log":
            continue
        yield path


def file_md5(path: Path) -> str:
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def list_r2_objects(s3, bucket: str, prefix: str = "data/") -> dict[str, dict]:
    """Return { key: {'etag': str, 'size': int} } for every object in the bucket."""
    out: dict[str, dict] = {}
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for item in page.get("Contents", []):
            out[item["Key"]] = {
                "etag": item["ETag"].strip('"'),
                "size": item["Size"],
            }
    return out


def classify(
    local_files: list[Path], r2_state: dict[str, dict], force: bool
) -> dict[str, list[dict]]:
    """Return dict with keys: upload, unchanged, protected, blocked."""
    upload: list[dict] = []
    unchanged: list[dict] = []
    protected: list[dict] = []
    blocked: list[dict] = []

    for path in local_files:
        rel = str(path.relative_to(DATA))
        r2_key = f"data/{rel}"

        # Layer 1: hard exclusion
        if any(rel.startswith(p) for p in PROTECTED_PREFIXES):
            protected.append({"key": r2_key, "reason": "worker-owned"})
            continue

        local_md5 = file_md5(path)
        remote = r2_state.get(r2_key)
        if remote and remote["etag"] == local_md5:
            unchanged.append({"key": r2_key, "path": path})
            continue

        if remote and rel.startswith("reviews/") and not force:
            # Layer 2: reviews append-only
            blocked.append(
                {
                    "key": r2_key,
                    "path": path,
                    "reason": "review already published; re-run with --force to overwrite",
                }
            )
            continue

        status = "NEW" if remote is None else "MODIFIED"
        upload.append({"key": r2_key, "path": path, "status": status, "md5": local_md5})

    return {"upload": upload, "unchanged": unchanged, "protected": protected, "blocked": blocked}


def print_plan(env: str, classification: dict[str, list[dict]]) -> None:
    upload = classification["upload"]
    unchanged = classification["unchanged"]
    protected = classification["protected"]
    blocked = classification["blocked"]

    print()
    print("+" + "-" * 56 + "+")
    print(f"| R2 Publish Plan ({env})".ljust(57) + "|")
    print("+" + "-" * 56 + "+")
    for item in upload:
        print(f"| {item['status']:<9} {item['key']}".ljust(57) + "|")
    for item in unchanged:
        print(f"| UNCHANGED {item['key']}".ljust(57) + "|")
    if protected:
        print(f"| PROTECTED responses/* ({len(protected)} files, worker-owned)".ljust(57) + "|")
    for item in blocked:
        print(f"| BLOCKED   {item['key']}".ljust(57) + "|")
        print(f"|   reason: {item['reason']}".ljust(57) + "|")
    print("+" + "-" * 56 + "+")
    print(
        f"| {len(upload)} to upload, {len(unchanged)} unchanged, "
        f"{len(protected)} protected, {len(blocked)} blocked".ljust(57) + "|"
    )
    print("+" + "-" * 56 + "+")
    print()


def require_confirmation(upload_count: int, yes: bool) -> bool:
    if yes or os.environ.get("REFRESH_YES") == "1":
        print("Confirmation bypassed (--yes / REFRESH_YES=1).")
        return True
    if upload_count == 0:
        print("Nothing to upload.")
        return True
    try:
        reply = input("Type \"publish\" to confirm: ").strip()
    except EOFError:
        reply = ""
    return reply == "publish"


def write_audit_log(
    s3, bucket: str, env: str, classification: dict[str, list[dict]]
) -> None:
    now = dt.datetime.now(dt.timezone.utc)
    ts = now.strftime("%Y%m%dT%H%M%SZ")
    log = {
        "who": os.environ.get("USER") or getpass.getuser(),
        "when": now.isoformat(),
        "env": env,
        "uploaded": [item["key"] for item in classification["upload"]],
        "skipped_unchanged": [item["key"] for item in classification["unchanged"]],
        "protected": [item["key"] for item in classification["protected"]],
        "blocked": [
            {"key": item["key"], "reason": item["reason"]}
            for item in classification["blocked"]
        ],
    }
    body = json.dumps(log, ensure_ascii=False, indent=2).encode("utf-8")
    key = f"data/_publish_log/{ts}.json"
    s3.put_object(
        Bucket=bucket,
        Key=key,
        Body=body,
        ContentType="application/json",
        CacheControl="public, max-age=60",
    )
    print(f"  Audit log: {key}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Safely publish data/ to Cloudflare R2")
    parser.add_argument("--stage", action="store_true")
    parser.add_argument("--prod", action="store_true")
    parser.add_argument("--yes", action="store_true", help="Skip interactive confirmation")
    parser.add_argument("--dry-run", action="store_true", help="Show plan and exit without uploading")
    parser.add_argument("--force", action="store_true", help="Allow overwriting already-published reviews/*")
    args = parser.parse_args()

    if not (args.stage or args.prod):
        print("Usage: publish_r2.py --stage | --prod [--yes] [--dry-run] [--force]")
        return 1
    env = "prod" if args.prod else "stage"

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

    local_files = list(iter_local_files())
    if not local_files:
        print("No JSON files under data/ — nothing to publish.")
        return 1

    print(f"Fetching R2 state for bucket {bucket}…")
    r2_state = list_r2_objects(s3, bucket)

    classification = classify(local_files, r2_state, args.force)
    print_plan(env, classification)

    if classification["blocked"] and not args.force:
        print(
            "Blocked by append-only policy. Re-run with --force if you really want to "
            "overwrite a published review."
        )
        return 2

    if args.dry_run:
        print("Dry run — no upload performed.")
        return 0

    if not require_confirmation(len(classification["upload"]), args.yes):
        print("Aborted by user.")
        return 1

    count = 0
    for item in classification["upload"]:
        path: Path = item["path"]
        key = item["key"]
        s3.upload_file(
            str(path),
            bucket,
            key,
            ExtraArgs={
                "ContentType": "application/json",
                "CacheControl": cache_control_for(key[len("data/"):], env),
            },
        )
        print(f"  {item['status']:<9} {key}")
        count += 1

    write_audit_log(s3, bucket, env, classification)
    print(f"\n[{env}] Upload complete: {count} files -> {bucket}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
