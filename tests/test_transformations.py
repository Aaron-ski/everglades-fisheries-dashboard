import json
import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[1] / "scripts"))

from pipeline_utils import area_region, normalize_area, safe_divide, species_id

ROOT = Path(__file__).resolve().parents[1]


def load_json(path: str):
    return json.loads((ROOT / path).read_text(encoding="utf-8"))


def test_area_code_normalization_and_regions():
    assert normalize_area("1.0") == "1"
    assert normalize_area("6c") == "6C"
    assert area_region("1E") == "Florida Bay / Cape Sable"
    assert area_region("4") == "Whitewater Bay"
    assert area_region("6S") == "Gulf Coast"


def test_species_id_is_stable():
    assert species_id("Cynoscion nebulosus", "Spotted Seatrout") == "cynoscion-nebulosus-spotted-seatrout"


def test_division_by_zero_returns_null():
    assert safe_divide(10, 0) is None
    assert safe_divide(10, None) is None
    assert safe_divide(10, 2) == 5


def test_expected_year_range_and_partial_years():
    metadata = load_json("public/data/source_metadata.json")
    coverage = load_json("public/data/coverage.json")
    assert metadata["date_coverage"]["unique_years"][0] == 1980
    assert metadata["date_coverage"]["unique_years"][-1] == 2025
    default_years = [row for row in coverage["years"] if 2005 <= row["year"] <= 2024]
    assert len(default_years) == 20
    assert all(not row["is_partial_year"] for row in default_years)
    assert next(row for row in coverage["years"] if row["year"] == 2025)["is_partial_year"] is True
    assert next(row for row in coverage["years"] if row["year"] == 2020)["coverage_status"] == "interrupted survey coverage"


def test_nonnegative_measures_and_cpue_recomputes():
    records = load_json("public/data/annual_species_area.json")[:5000]
    for row in records:
        assert row["catch"] >= 0
        assert row["kept"] >= 0
        assert row["released"] >= 0
        if row["effort_denominator"] is not None:
            assert row["effort_denominator"] >= 0
            if row["effort_denominator"] > 0:
                assert abs(row["cpue"] - row["catch"] / row["effort_denominator"]) < 1e-9


def test_duplicate_aggregate_keys_absent():
    area_records = load_json("public/data/annual_species_area.json")
    region_records = load_json("public/data/annual_species_region.json")
    assert len(area_records) == len({(row["year"], row["species_id"], row["area_code"]) for row in area_records})
    assert len(region_records) == len({(row["year"], row["species_id"], row["broad_region"]) for row in region_records})


def test_kept_plus_released_reconcile_with_catch():
    records = load_json("public/data/annual_species_region.json")
    sample = [row for row in records if row["catch"] > 0][:5000]
    assert sample
    for row in sample:
        assert row["kept"] + row["released"] == row["catch"]
