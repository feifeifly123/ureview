#!/usr/bin/env python3
"""校验 data/ 下所有 JSON 是否符合 contracts/ 中的 schema，并检查索引引用一致性。"""

import json
import sys
from pathlib import Path

try:
    from jsonschema import validate, ValidationError
except ImportError:
    print("请先安装 jsonschema: pip install jsonschema")
    sys.exit(1)

ROOT = Path(__file__).resolve().parent.parent
CONTRACTS = ROOT / "contracts"
DATA = ROOT / "data"


def load_json(path: Path) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def main() -> int:
    errors: list[str] = []

    review_schema = load_json(CONTRACTS / "review.schema.json")
    latest_schema = load_json(CONTRACTS / "latest.schema.json")
    daily_schema = load_json(CONTRACTS / "daily.schema.json")

    # 收集所有 review 文件的 id
    review_ids: set[str] = set()
    reviews_dir = DATA / "reviews"
    if reviews_dir.exists():
        for f in sorted(reviews_dir.glob("*.json")):
            data = load_json(f)
            try:
                validate(instance=data, schema=review_schema)
                review_ids.add(data["id"])
                print(f"  OK  {f.relative_to(ROOT)}")
            except ValidationError as e:
                errors.append(f"{f.relative_to(ROOT)}: {e.message}")
                print(f" FAIL {f.relative_to(ROOT)}: {e.message}")

    # 校验 latest.json
    latest_path = DATA / "latest.json"
    if latest_path.exists():
        data = load_json(latest_path)
        try:
            validate(instance=data, schema=latest_schema)
            print(f"  OK  {latest_path.relative_to(ROOT)}")
        except ValidationError as e:
            errors.append(f"latest.json: {e.message}")
            print(f" FAIL latest.json: {e.message}")

        # 检查引用一致性
        for entry in data.get("reviews", []):
            if entry["id"] not in review_ids:
                msg = f"latest.json 引用了不存在的 review: {entry['id']}"
                errors.append(msg)
                print(f" FAIL {msg}")

    # 校验 daily/*.json
    daily_dir = DATA / "daily"
    if daily_dir.exists():
        for f in sorted(daily_dir.glob("*.json")):
            data = load_json(f)
            try:
                validate(instance=data, schema=daily_schema)
                print(f"  OK  {f.relative_to(ROOT)}")
            except ValidationError as e:
                errors.append(f"{f.relative_to(ROOT)}: {e.message}")
                print(f" FAIL {f.relative_to(ROOT)}: {e.message}")

            for entry in data.get("reviews", []):
                if entry["id"] not in review_ids:
                    msg = f"{f.name} 引用了不存在的 review: {entry['id']}"
                    errors.append(msg)
                    print(f" FAIL {msg}")

    if errors:
        print(f"\n校验失败: {len(errors)} 个错误")
        return 1

    print("\n全部校验通过")
    return 0


if __name__ == "__main__":
    sys.exit(main())
