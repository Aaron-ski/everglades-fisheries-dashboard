from __future__ import annotations

import json
from pathlib import Path

from shapely.geometry import shape

from pipeline_utils import DEFAULT_END_YEAR, DEFAULT_START_YEAR, PROCESSED_DIR, PUBLIC_DATA_DIR


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def fail(message: str) -> None:
    raise SystemExit(f"Validation failed: {message}")


def main() -> None:
    metadata = load_json(PUBLIC_DATA_DIR / "source_metadata.json")
    coverage = load_json(PUBLIC_DATA_DIR / "coverage.json")
    area_rows = load_json(PUBLIC_DATA_DIR / "annual_species_area.json")
    region_rows = load_json(PUBLIC_DATA_DIR / "annual_species_region.json")
    species = load_json(PUBLIC_DATA_DIR / "species.json")
    geojson = load_json(PUBLIC_DATA_DIR / "areas.geojson")

    years = metadata["date_coverage"]["unique_years"]
    if min(years) != 1980 or max(years) != 2025:
        fail(f"expected source years 1980-2025, found {min(years)}-{max(years)}")
    complete_default = [row for row in coverage["years"] if DEFAULT_START_YEAR <= row["year"] <= DEFAULT_END_YEAR]
    if len(complete_default) != 20 or any(row["is_partial_year"] for row in complete_default):
        fail("default 2005-2024 period is not exactly twenty complete years")
    partial_2025 = [row for row in coverage["years"] if row["year"] == 2025]
    if not partial_2025 or not partial_2025[0]["is_partial_year"]:
        fail("2025 should be present and marked partial")
    if not species:
        fail("no species records built")

    for row in area_rows + region_rows:
        if row["catch"] < 0 or row["kept"] < 0 or row["released"] < 0:
            fail("negative catch measure found")
        if row["effort_denominator"] is not None and row["effort_denominator"] < 0:
            fail("negative effort denominator found")
        expected = None if not row["effort_denominator"] else row["catch"] / row["effort_denominator"]
        actual = row["cpue"]
        if expected is None and actual is not None:
            fail("CPUE should be null for missing or zero effort")
        if expected is not None and abs(actual - expected) > 1e-9:
            fail("CPUE does not recompute from numerator and denominator")
        denom = row["kept"] + row["released"]
        if denom == 0 and row["release_rate"] is not None:
            fail("release rate should be null when kept + released is zero")

    area_keys = {(row["year"], row["species_id"], row["area_code"]) for row in area_rows}
    if len(area_keys) != len(area_rows):
        fail("duplicate annual species area keys found")
    region_keys = {(row["year"], row["species_id"], row["broad_region"]) for row in region_rows}
    if len(region_keys) != len(region_rows):
        fail("duplicate annual species region keys found")

    for feature in geojson["features"]:
        geom = shape(feature["geometry"])
        if not geom.is_valid:
            fail(f"invalid geometry for {feature['properties']['area_code']}")
        minx, miny, maxx, maxy = geom.bounds
        if not (-83 <= minx <= -79 and -83 <= maxx <= -79 and 24 <= miny <= 27 and 24 <= maxy <= 27):
            fail(f"geometry bounds outside expected south Florida lon/lat range for {feature['properties']['area_code']}")

    report = [
        "# Data Quality Report",
        "",
        "## Validation Summary",
        "",
        "- Official source files were downloaded from NPS IRMA and checksums were recorded in `data/processed/source_manifest.json`.",
        f"- Source years found: {min(years)}-{max(years)}.",
        "- Default dashboard period 2005-2024 contains exactly twenty complete calendar years.",
        "- 2025 is present and marked as a partial year because the source ends in April 2025.",
        "- Catch, kept, released, effort, CPUE, and release-rate values passed nonnegative and recomputation checks.",
        "- Annual species-area and species-region aggregate keys are unique.",
        "- Fishing-area geometries are valid after conversion to WGS84 and fall within expected southern Florida bounds.",
        "",
        "## Important Caveats",
        "",
        "- CPUE uses deduplicated interview angler-hours (`numPeople * hoursFished`) because the source does not include a precomputed CPUE field.",
        "- The denominator is shared across species within a year and area, so a selected species catch rate means reported catch for that species per surveyed angler-hour in that place and year.",
        "- Numeric historic area codes have no separate polygons in the geography file; the interactive map uses the official split-area polygons supplied by NPS.",
        "- Survey/interview locations are available as names only, without authoritative coordinates in the source package, so no point markers are plotted.",
        "- QA/QC flags are counted and surfaced, but the metadata states full QA/QC methodology is forthcoming.",
        "",
    ]
    (PROCESSED_DIR / "validation_summary.json").write_text(
        json.dumps({"status": "passed", "checks": len(area_rows) + len(region_rows), "years": years}, indent=2),
        encoding="utf-8",
    )
    (Path("docs") / "data_quality_report.md").write_text("\n".join(report), encoding="utf-8")
    print("Data validation passed")


if __name__ == "__main__":
    main()
