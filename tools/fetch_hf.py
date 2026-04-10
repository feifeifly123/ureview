#!/usr/bin/env python3
"""从 Hugging Face 获取每日热门论文。（v1 stub）"""

import json
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw"


def main() -> int:
    today = date.today().isoformat()
    RAW_DIR.mkdir(parents=True, exist_ok=True)

    # TODO: 替换为真实 HF Daily Papers API 调用
    # https://huggingface.co/api/daily_papers
    stub_papers = [
        {
            "title": f"[Stub] Paper A ({today})",
            "url": "https://arxiv.org/abs/0000.00000",
            "abstract": "This is a placeholder abstract.",
            "rank": 1,
        },
        {
            "title": f"[Stub] Paper B ({today})",
            "url": "https://arxiv.org/abs/0000.00001",
            "abstract": "This is another placeholder abstract.",
            "rank": 2,
        },
    ]

    out_path = RAW_DIR / f"{today}.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(stub_papers, f, ensure_ascii=False, indent=2)

    print(f"已保存 {len(stub_papers)} 篇论文到 {out_path.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
