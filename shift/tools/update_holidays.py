from __future__ import annotations

import csv
import json
from pathlib import Path
from urllib.request import urlopen

CSV_URL = "https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv"
OUT_PATH = Path(__file__).resolve().parents[1] / "holidays.json"


def normalize_date(text: str) -> str:
    y, m, d = text.strip().split("/")
    return f"{int(y):04d}-{int(m):02d}-{int(d):02d}"


def main() -> int:
    with urlopen(CSV_URL) as response:
        raw = response.read()

    text = raw.decode("cp932")
    rows = csv.DictReader(text.splitlines())
    holidays: dict[str, str] = {}

    for row in rows:
        date_text = row.get("国民の祝日・休日月日")
        name = row.get("国民の祝日・休日名称")

        if date_text and name:
            holidays[normalize_date(date_text)] = name.strip()

    OUT_PATH.write_text(
        json.dumps(holidays, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print(f"wrote {OUT_PATH} ({len(holidays)} holidays)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
