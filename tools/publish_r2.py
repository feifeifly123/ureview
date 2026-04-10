#!/usr/bin/env python3
"""将 data/ 目录上传到 Cloudflare R2。"""

import os
import sys
from pathlib import Path

try:
    import boto3
except ImportError:
    print("请先安装 boto3: pip install boto3")
    sys.exit(1)

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"


def get_env(key: str) -> str:
    val = os.environ.get(key)
    if not val:
        print(f"缺少环境变量: {key}")
        sys.exit(1)
    return val


def main() -> int:
    if "--prod" in sys.argv:
        env = "prod"
    elif "--stage" in sys.argv:
        env = "stage"
    else:
        print("用法: publish_r2.py --stage | --prod")
        return 1

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

    # 先上传单篇 review，再上传索引
    upload_order = []
    reviews_dir = DATA / "reviews"
    if reviews_dir.exists():
        upload_order.extend(sorted(reviews_dir.glob("*.json")))
    daily_dir = DATA / "daily"
    if daily_dir.exists():
        upload_order.extend(sorted(daily_dir.glob("*.json")))
    latest = DATA / "latest.json"
    if latest.exists():
        upload_order.append(latest)

    cache_control = "public, max-age=60" if env == "stage" else "public, max-age=300"

    count = 0
    for filepath in upload_order:
        key = str(filepath.relative_to(DATA))
        s3.upload_file(
            str(filepath),
            bucket,
            f"data/{key}",
            ExtraArgs={
                "ContentType": "application/json",
                "CacheControl": cache_control,
            },
        )
        print(f"  上传 data/{key}")
        count += 1

    print(f"\n[{env}] 上传完成: {count} 个文件 → {bucket}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
