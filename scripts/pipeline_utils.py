from __future__ import annotations

import hashlib
import json
import math
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import unquote
from urllib.request import Request, urlopen

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / "data" / "raw"
PROCESSED_DIR = ROOT / "data" / "processed"
PUBLIC_DATA_DIR = ROOT / "public" / "data"
DOCS_DIR = ROOT / "docs"

SOURCE_URLS = {
    "catch_effort": "https://irma.nps.gov/DataStore/DownloadFile/759623?Reference=2318429",
    "area_geography": "https://irma.nps.gov/DataStore/DownloadFile/759622?Reference=2318429",
    "qc_flags": "https://irma.nps.gov/DataStore/DownloadFile/759624?Reference=2318429",
    "metadata": "https://irma.nps.gov/DataStore/DownloadFile/759625?Reference=2318429",
    "boat_trailer_counts": "https://irma.nps.gov/DataStore/DownloadFile/759626?Reference=2318429",
}

EXPECTED_FILES = {
    "catch_effort": "EVER_creel_rec_catch.csv",
    "area_geography": "EVER_creel_fishing_areas.csv",
    "qc_flags": "EVER_creel_rec_catch_flags.csv",
    "metadata": "EVER_creel_rec_metadata.xml",
    "boat_trailer_counts": "EVER_creel_rec_trailer_count.csv",
}

DEFAULT_START_YEAR = 2005
DEFAULT_END_YEAR = 2024
SOURCE_PAGE = "https://irma.nps.gov/DataStore/Reference/Profile/2318429"
CATALOG_PAGE = "https://catalog.data.gov/dataset/recreational-fishing-catch-and-effort-in-everglades-national-park-1980-2025-data-package"


def ensure_dirs() -> None:
    for path in (RAW_DIR, PROCESSED_DIR, PUBLIC_DATA_DIR, DOCS_DIR):
        path.mkdir(parents=True, exist_ok=True)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def download_source(key: str, url: str, force: bool = False) -> dict[str, Any]:
    ensure_dirs()
    expected = EXPECTED_FILES[key]
    path = RAW_DIR / expected
    if path.exists() and not force:
        return {
            "key": key,
            "url": url,
            "filename": expected,
            "status": "cached",
            "content_type": None,
            "size": path.stat().st_size,
            "sha256": sha256_file(path),
            "retrieved_at": datetime.now(timezone.utc).isoformat(),
        }

    request = Request(url, headers={"User-Agent": "Everglades Fisheries Explorer data pipeline"})
    with urlopen(request, timeout=180) as response:
        data = response.read()
        disposition = response.headers.get("Content-Disposition", "")
        match = re.search(r"filename\*?=(?:UTF-8'')?\"?([^\";]+)", disposition)
        filename = unquote(match.group(1)) if match else expected
        filename = filename.replace("/", "_").replace("\\", "_")
        if filename != expected:
            filename = expected
        path.write_bytes(data)
        return {
            "key": key,
            "url": url,
            "filename": filename,
            "status": response.status,
            "content_type": response.headers.get("Content-Type"),
            "size": len(data),
            "sha256": hashlib.sha256(data).hexdigest(),
            "retrieved_at": datetime.now(timezone.utc).isoformat(),
        }


def sanitize_for_json(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): sanitize_for_json(item) for key, item in value.items()}
    if isinstance(value, list):
        return [sanitize_for_json(item) for item in value]
    if isinstance(value, tuple):
        return [sanitize_for_json(item) for item in value]
    if pd.isna(value) if not isinstance(value, (list, tuple, dict, str)) else False:
        return None
    if hasattr(value, "item"):
        return sanitize_for_json(value.item())
    return value


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(sanitize_for_json(payload), indent=2, sort_keys=True, allow_nan=False), encoding="utf-8")


def read_manifest() -> dict[str, Any]:
    path = PROCESSED_DIR / "source_manifest.json"
    if not path.exists():
        return {"files": []}
    return json.loads(path.read_text(encoding="utf-8"))


def normalize_area(value: Any) -> str | None:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    text = str(value).strip().upper()
    if not text or text == "NAN":
        return None
    if text.endswith(".0"):
        text = text[:-2]
    return text


def area_region(area_code: str | None) -> str:
    if not area_code:
        return "Unknown"
    code = normalize_area(area_code)
    if not code:
        return "Unknown"
    if code[0] in {"1", "2", "3"}:
        return "Florida Bay / Cape Sable"
    if code[0] == "4":
        return "Whitewater Bay"
    if code[0] in {"5", "6"}:
        return "Gulf Coast"
    return "Unknown"


def historic_area_name(area_code: str | None) -> str:
    code = normalize_area(area_code)
    names = {
        "1": "Historic area 1",
        "2": "Historic area 2",
        "3": "Historic area 3",
        "4": "Whitewater Bay",
        "5": "Shark River",
        "6": "Historic area 6",
    }
    if not code:
        return "Unknown area"
    return names.get(code, code)


def species_id(scientific_name: Any, common_name: Any) -> str:
    scientific = "" if scientific_name is None or pd.isna(scientific_name) else str(scientific_name)
    common = "" if common_name is None or pd.isna(common_name) else str(common_name)
    source = f"{scientific}-{common}".lower()
    source = re.sub(r"[^a-z0-9]+", "-", source).strip("-")
    return source or "unknown-species"


def is_noncatch_species(common_name: Any, scientific_name: Any) -> bool:
    common = "" if common_name is None or pd.isna(common_name) else str(common_name)
    scientific = "" if scientific_name is None or pd.isna(scientific_name) else str(scientific_name)
    text = f"{common} {scientific}".strip().lower()
    return text in {"no fish caught no fish caught", "did not fish did not fish"} or text in {
        "no fish caught",
        "did not fish",
    }


def safe_divide(numerator: float, denominator: float) -> float | None:
    if denominator is None or pd.isna(denominator) or denominator <= 0:
        return None
    return float(numerator) / float(denominator)


def coverage_status(months_present: int, survey_count: int) -> str:
    if months_present < 12:
        return "partial year"
    if survey_count < 30:
        return "sparse survey coverage"
    return "complete year"


def complete_years_from_months(months_by_year: dict[int, int]) -> list[int]:
    return sorted(year for year, months in months_by_year.items() if months == 12)
