"""Validate and summarize the downloaded Big 4 audit CSV."""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd


ROOT = Path(__file__).resolve().parent
RAW_DIR = ROOT / "data" / "raw"
OUTPUT_DIR = ROOT / "outputs" / "big4"


def locate_csv() -> Path:
    candidates = sorted(RAW_DIR.rglob("*.csv"))
    if not candidates:
        raise FileNotFoundError("No CSV found. Run download_big4_data.py first.")
    preferred = [path for path in candidates if "big4" in path.name.lower()]
    return (preferred or candidates)[0]


def main() -> None:
    source = locate_csv()
    frame = pd.read_csv(source)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    profile = {
        "source": source.relative_to(ROOT).as_posix(),
        "rows": int(len(frame)),
        "columns": int(len(frame.columns)),
        "column_names": frame.columns.tolist(),
        "missing_values": {key: int(value) for key, value in frame.isna().sum().items()},
        "duplicate_rows": int(frame.duplicated().sum()),
        "dtypes": {key: str(value) for key, value in frame.dtypes.items()},
    }
    (OUTPUT_DIR / "profile.json").write_text(json.dumps(profile, indent=2), encoding="utf-8")
    frame.describe(include="all").transpose().to_csv(OUTPUT_DIR / "summary_statistics.csv")
    print(json.dumps(profile, indent=2))


if __name__ == "__main__":
    main()

