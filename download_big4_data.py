"""Download the Big 4 Financial Risk & Compliance dataset from Kaggle."""

from __future__ import annotations

import shutil
from pathlib import Path

import kagglehub


DATASET = "pinisetty/big-4-financial-risk-and-compliance-analysis"
PROJECT_ROOT = Path(__file__).resolve().parent
RAW_DIR = PROJECT_ROOT / "data" / "raw"


def main() -> None:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    cached_dir = Path(kagglehub.dataset_download(DATASET))
    copied = []
    for source in cached_dir.rglob("*"):
        if not source.is_file():
            continue
        destination = RAW_DIR / source.relative_to(cached_dir)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
        copied.append(destination.relative_to(PROJECT_ROOT).as_posix())

    print(f"Downloaded {len(copied)} file(s) from {DATASET}:")
    for item in copied:
        print(f"- {item}")


if __name__ == "__main__":
    main()

