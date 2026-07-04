from __future__ import annotations

import json
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path
from typing import Any

import pandas as pd

from pipeline_utils import (
    CATALOG_PAGE,
    DOCS_DIR,
    EXPECTED_FILES,
    PROCESSED_DIR,
    RAW_DIR,
    SOURCE_PAGE,
    area_region,
    normalize_area,
    read_manifest,
    write_json,
)


IMPORTANT_FIELDS = {
    "catch_effort": [
        "eventDate",
        "interviewLocation",
        "interviewNumber",
        "numPeople",
        "hoursFished",
        "areaFished",
        "scientificName_catch",
        "commonName_catch",
        "disposition",
        "individualCount",
        "flags",
    ],
    "area_geography": ["zone", "zoneName", "wkt"],
    "qc_flags": ["flagDescription"],
    "boat_trailer_counts": ["parking_lot", "eventDate", "trailer_count"],
}


def file_profile(path: Path, key: str) -> dict[str, Any]:
    if path.suffix.lower() == ".xml":
        text = path.read_text(encoding="utf-8", errors="ignore")
        root = ET.fromstring(text)
        return {
            "filename": path.name,
            "size_bytes": path.stat().st_size,
            "format": "xml",
            "root_tag": root.tag,
            "column_count": None,
            "row_count": None,
            "columns": [],
            "sample_values": {},
        }

    sample = pd.read_csv(path, nrows=200)
    row_count = sum(1 for _ in path.open("rb")) - 1
    profile: dict[str, Any] = {
        "filename": path.name,
        "size_bytes": path.stat().st_size,
        "format": "csv",
        "row_count": row_count,
        "column_count": len(sample.columns),
        "columns": list(sample.columns),
        "inferred_types": {column: str(dtype) for column, dtype in sample.dtypes.items()},
        "sample_values": {
            column: [None if pd.isna(value) else value for value in sample[column].head(5).tolist()]
            for column in sample.columns
        },
        "missingness": {},
    }
    fields = [field for field in IMPORTANT_FIELDS.get(key, []) if field in sample.columns]
    if fields:
        missing_counts = {field: 0 for field in fields}
        total = 0
        for chunk in pd.read_csv(path, usecols=fields, chunksize=200_000, low_memory=False):
            total += len(chunk)
            for field in fields:
                missing_counts[field] += int(chunk[field].isna().sum())
        profile["missingness"] = {
            field: {"missing": missing, "total": total, "rate": missing / total if total else None}
            for field, missing in missing_counts.items()
        }
    return profile


def catch_details(path: Path) -> dict[str, Any]:
    columns = [
        "eventDate",
        "interviewLocation",
        "interviewNumber",
        "numPeople",
        "hoursFished",
        "areaFished",
        "scientificName_catch",
        "commonName_catch",
        "disposition",
        "individualCount",
        "flags",
    ]
    years: set[int] = set()
    months_by_year: dict[int, set[int]] = {}
    species = Counter()
    areas = Counter()
    dispositions = Counter()
    min_date = None
    max_date = None
    effort_rows = 0
    effort_missing = 0
    negative_catch = 0
    for chunk in pd.read_csv(path, usecols=columns, chunksize=250_000, parse_dates=["eventDate"]):
        dates = chunk["eventDate"]
        min_date = dates.min() if min_date is None else min(min_date, dates.min())
        max_date = dates.max() if max_date is None else max(max_date, dates.max())
        for year, month in zip(dates.dt.year, dates.dt.month):
            years.add(int(year))
            months_by_year.setdefault(int(year), set()).add(int(month))
        species.update(chunk["commonName_catch"].fillna("Unknown").astype(str).tolist())
        areas.update(chunk["areaFished"].map(normalize_area).fillna("Unknown").astype(str).tolist())
        dispositions.update(chunk["disposition"].fillna("NA").astype(str).tolist())
        effort_rows += len(chunk)
        effort_missing += int((chunk["numPeople"].isna() | chunk["hoursFished"].isna()).sum())
        negative_catch += int((chunk["individualCount"] < 0).sum())
    return {
        "min_date": min_date.date().isoformat() if min_date is not None else None,
        "max_date": max_date.date().isoformat() if max_date is not None else None,
        "unique_years": sorted(years),
        "months_present_by_year": {str(year): len(months) for year, months in sorted(months_by_year.items())},
        "species_values": [{"name": name, "records": count} for name, count in species.most_common()],
        "fishing_area_values": [
            {"area_code": code, "records": count, "broad_region": area_region(code)}
            for code, count in sorted(areas.items(), key=lambda item: item[0])
        ],
        "disposition_values": dict(dispositions),
        "effort_related_fields": ["numPeople", "hoursFished", "hoursTrip"],
        "effort_missing_rows": effort_missing,
        "effort_total_rows": effort_rows,
        "negative_catch_rows": negative_catch,
        "quality_control_fields": ["flags", "EVER_creel_rec_catch_flags.csv.flagDescription"],
    }


def geography_details(path: Path) -> dict[str, Any]:
    df = pd.read_csv(path)
    return {
        "geometry_format": "WKT polygons",
        "source_crs": "NAD 1983 UTM Zone 17N (EPSG:26917), from NPS metadata wkt attribute definition",
        "browser_crs": "WGS84 longitude/latitude (EPSG:4326)",
        "area_count": len(df),
        "areas": df[["zone", "zoneName"]].to_dict(orient="records"),
    }


def write_markdown(profile: dict[str, Any]) -> None:
    lines = [
        "# Source Profile",
        "",
        f"Generated from the official NPS IRMA package: {SOURCE_PAGE}",
        "",
        f"Data.gov catalog: {CATALOG_PAGE}",
        "",
        "## Coverage",
        "",
        f"- Catch records date range: {profile['catch_details']['min_date']} to {profile['catch_details']['max_date']}",
        f"- Unique years: {profile['catch_details']['unique_years'][0]}-{profile['catch_details']['unique_years'][-1]}",
        "- 2025 is partial in the source and is excluded from the default 2005-2024 dashboard view.",
        "",
        "## Files",
        "",
    ]
    for item in profile["files"]:
        lines.extend(
            [
                f"### {item['filename']}",
                "",
                f"- Size: {item['size_bytes']:,} bytes",
                f"- Format: {item['format']}",
                f"- Rows: {item.get('row_count')}",
                f"- Columns: {item.get('column_count')}",
                f"- Column names: {', '.join(item.get('columns') or [])}",
                "",
            ]
        )
    lines.extend(
        [
            "## Important Fields Found",
            "",
            "- Dates: `eventDate`",
            "- Species: `scientificName_catch`, `commonName_catch`",
            "- Areas: `areaFished`, joined to `EVER_creel_fishing_areas.csv.zone` where polygons exist",
            "- Catch count: `individualCount`",
            "- Kept/released: `disposition` values `harvested` and `released`",
            "- Effort inputs: `numPeople` and `hoursFished`; dashboard denominator is computed as angler-hours",
            "- Survey/interview key: `interviewLocation`, `eventDate`, `interviewNumber`",
            "- Quality-control fields: `flags` plus detailed descriptions in `EVER_creel_rec_catch_flags.csv`",
            "",
            "## Geography",
            "",
            f"- Geometry format: {profile['geography']['geometry_format']}",
            f"- Source coordinate system: {profile['geography']['source_crs']}",
            "- Coordinates are converted to WGS84 GeoJSON for Leaflet.",
            "",
            "## Area Values",
            "",
        ]
    )
    for area in profile["catch_details"]["fishing_area_values"]:
        lines.append(f"- `{area['area_code']}`: {area['records']:,} records; region `{area['broad_region']}`")
    lines.extend(["", "## Species Values", ""])
    for species in profile["catch_details"]["species_values"][:60]:
        lines.append(f"- {species['name']}: {species['records']:,} records")
    lines.extend(
        [
            "",
            "## Known Inconsistencies And Limitations",
            "",
            "- Numeric area codes 1, 2, 3, and 6 appear in older records; the polygon file contains the later split areas such as 1E, 1W, 6N, 6C, and 6S.",
            "- The metadata says areaFished may represent the area where anglers spent the most time, caught the most fish, or the furthest area traveled for some Everglades City surveys.",
            "- No authoritative survey-site coordinates were found in the source files, so the dashboard omits exact point markers.",
            "- CPUE is a reported catch-rate indicator from surveyed/interviewed trips, not a fish population estimate.",
            "",
        ]
    )
    (DOCS_DIR / "source_profile.md").write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    manifest = read_manifest()
    files = []
    for key, filename in EXPECTED_FILES.items():
        files.append(file_profile(RAW_DIR / filename, key))
    profile = {
        "source_page": SOURCE_PAGE,
        "catalog_page": CATALOG_PAGE,
        "manifest": manifest,
        "files": files,
        "catch_details": catch_details(RAW_DIR / EXPECTED_FILES["catch_effort"]),
        "geography": geography_details(RAW_DIR / EXPECTED_FILES["area_geography"]),
    }
    write_json(PROCESSED_DIR / "source_profile.json", profile)
    write_markdown(profile)
    print("Wrote docs/source_profile.md and data/processed/source_profile.json")


if __name__ == "__main__":
    main()
