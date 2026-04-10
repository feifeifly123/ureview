#!/usr/bin/env python3
"""从 data/reviews/*.json 重新生成 latest.json 和 daily/*.json 索引。"""

import json
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
REVIEWS_DIR = DATA / "reviews"
DAILY_DIR = DATA / "daily"


def load_json(path: Path) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def write_json(path: Path, obj: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
    print(f"  写入 {path.relative_to(ROOT)}")


def main() -> int:
    if not REVIEWS_DIR.exists():
        print("data/reviews/ 目录不存在")
        return 1

    reviews = []
    for f in sorted(REVIEWS_DIR.glob("*.json")):
        reviews.append(load_json(f))

    if not reviews:
        print("没有找到任何 review 文件")
        return 1

    # 按日期分组
    by_date: dict[str, list[dict]] = defaultdict(list)
    for r in reviews:
        by_date[r["date"]].append(r)

    # 生成 daily/*.json
    DAILY_DIR.mkdir(parents=True, exist_ok=True)
    for date, items in sorted(by_date.items()):
        daily = {
            "date": date,
            "reviews": [
                {
                    "id": r["id"],
                    "title": r["title"],
                    "summary": r["summary"],
                    "score": r["review"]["score"],
                    **({"hf_rank": r["hf_rank"]} if "hf_rank" in r else {}),
                }
                for r in items
            ],
        }
        write_json(DAILY_DIR / f"{date}.json", daily)

    # 生成 latest.json（最新 50 篇，按日期倒序）
    reviews.sort(key=lambda r: r["updated_at"], reverse=True)
    latest = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "reviews": [
            {
                "id": r["id"],
                "date": r["date"],
                "title": r["title"],
                "summary": r["summary"],
                "score": r["review"]["score"],
            }
            for r in reviews[:50]
        ],
    }
    write_json(DATA / "latest.json", latest)

    print(f"\n索引生成完成: {len(reviews)} 篇 review, {len(by_date)} 天")
    return 0


if __name__ == "__main__":
    sys.exit(main())
