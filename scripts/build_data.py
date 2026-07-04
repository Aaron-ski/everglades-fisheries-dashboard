from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd
from pyproj import Transformer
from shapely import make_valid
from shapely.geometry import mapping
from shapely.ops import transform
from shapely.wkt import loads as load_wkt

from pipeline_utils import (
    CATALOG_PAGE,
    DEFAULT_END_YEAR,
    DEFAULT_START_YEAR,
    EXPECTED_FILES,
    PROCESSED_DIR,
    PUBLIC_DATA_DIR,
    RAW_DIR,
    SOURCE_PAGE,
    area_region,
    coverage_status,
    historic_area_name,
    is_noncatch_species,
    normalize_area,
    read_manifest,
    safe_divide,
    species_id,
    write_json,
)

REGIONS = ["Florida Bay / Cape Sable", "Whitewater Bay", "Gulf Coast"]


def load_area_lookup() -> dict[str, dict[str, str]]:
    areas = pd.read_csv(RAW_DIR / EXPECTED_FILES["area_geography"])
    lookup = {
        normalize_area(row.zone): {
            "area_code": normalize_area(row.zone),
            "area_name": row.zoneName,
            "broad_region": area_region(row.zone),
        }
        for row in areas.itertuples(index=False)
    }
    for code in ["1", "2", "3", "4", "5", "6"]:
        lookup.setdefault(code, {"area_code": code, "area_name": historic_area_name(code), "broad_region": area_region(code)})
    return lookup


def build_coverage(catch: pd.DataFrame, trailers: pd.DataFrame, area_lookup: dict[str, dict[str, str]]) -> dict[str, Any]:
    interviews = catch[
        [
            "interviewLocation",
            "eventDate",
            "interviewNumber",
            "numPeople",
            "hoursFished",
            "area_code",
            "broad_region",
        ]
    ].drop_duplicates(["interviewLocation", "eventDate", "interviewNumber"])
    interviews["year"] = interviews["eventDate"].dt.year
    interviews["month"] = interviews["eventDate"].dt.month
    interviews["valid_effort"] = (
        interviews["numPeople"].notna()
        & interviews["hoursFished"].notna()
        & (interviews["numPeople"] >= 0)
        & (interviews["hoursFished"] >= 0)
    )
    interviews["angler_hours"] = (interviews["numPeople"] * interviews["hoursFished"]).where(interviews["valid_effort"])
    interviews["fishing_hours"] = interviews["hoursFished"].where(interviews["valid_effort"])
    interviews["anglers"] = interviews["numPeople"].where(interviews["valid_effort"])

    months_by_year = interviews.groupby("year")["month"].nunique().astype(int).to_dict()
    min_date = interviews["eventDate"].min()
    max_date = interviews["eventDate"].max()
    min_year = int(min_date.year)
    max_year = int(max_date.year)

    def is_boundary_partial(year: int) -> bool:
        return (year == min_year and int(min_date.month) > 1) or (year == max_year and int(max_date.month) < 12)

    def status_for(year: int, months: int, survey_count: int) -> str:
        if is_boundary_partial(year):
            return "partial year"
        if months < 12:
            return "interrupted survey coverage"
        if survey_count < 30:
            return "sparse survey coverage"
        return "complete year"

    year_rows = []
    for year, group in interviews.groupby("year"):
        months = int(group["month"].nunique())
        survey_count = int(len(group))
        year_rows.append(
            {
                "year": int(year),
                "months_present": months,
                "is_partial_year": is_boundary_partial(int(year)),
                "survey_count": survey_count,
                "coverage_status": status_for(int(year), months, survey_count),
            }
        )

    def summarize(group_cols: list[str]) -> list[dict[str, Any]]:
        grouped = (
            interviews.groupby(["year", *group_cols], dropna=False)
            .agg(
                months_present=("month", "nunique"),
                surveyed_trips=("interviewNumber", "count"),
                effort_denominator=("angler_hours", "sum"),
                fishing_hours=("fishing_hours", "sum"),
                anglers=("anglers", "sum"),
                missing_effort_trips=("valid_effort", lambda values: int((~values).sum())),
            )
            .reset_index()
        )
        rows = []
        for row in grouped.itertuples(index=False):
            item = row._asdict()
            year = int(item["year"])
            months = int(months_by_year.get(year, item["months_present"]))
            item["year"] = year
            item["months_present"] = months
            item["is_partial_year"] = is_boundary_partial(year)
            item["coverage_status"] = status_for(year, months, int(item["surveyed_trips"]))
            item["effort_unit"] = "angler-hours"
            for field in ["effort_denominator", "fishing_hours", "anglers"]:
                item[field] = round(float(item[field]), 4)
            rows.append(item)
        return rows

    area_rows = summarize(["area_code"])
    for row in area_rows:
        info = area_lookup.get(row["area_code"], {"area_name": historic_area_name(row["area_code"]), "broad_region": area_region(row["area_code"])})
        row["area_name"] = info["area_name"]
        row["broad_region"] = info["broad_region"]
    region_rows = summarize(["broad_region"])

    trailers = trailers.copy()
    trailers["year"] = trailers["eventDate"].dt.year
    trailer_rows = (
        trailers.groupby(["year", "parking_lot"], dropna=False)
        .agg(trailer_count=("trailer_count", "sum"), trailer_days=("eventDate", "nunique"))
        .reset_index()
    )

    return {
        "years": year_rows,
        "area": area_rows,
        "region": region_rows,
        "trailer_counts": trailer_rows.to_dict(orient="records"),
    }


def build_species_and_aggregates(catch: pd.DataFrame, coverage: dict[str, Any], area_lookup: dict[str, dict[str, str]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], str]:
    fish = catch[~catch["is_noncatch"] & catch["disposition"].isin(["harvested", "released"])].copy()
    fish["kept"] = fish["individualCount"].where(fish["disposition"] == "harvested", 0)
    fish["released"] = fish["individualCount"].where(fish["disposition"] == "released", 0)

    species_summary = (
        fish.groupby(["species_id", "scientificName_catch", "commonName_catch"], dropna=False)
        .agg(
            total_catch=("individualCount", "sum"),
            kept=("kept", "sum"),
            released=("released", "sum"),
            first_year=("year", "min"),
            last_year=("year", "max"),
            record_count=("individualCount", "count"),
            default_period_catch=("individualCount", lambda values: float(values[fish.loc[values.index, "year"].between(DEFAULT_START_YEAR, DEFAULT_END_YEAR)].sum())),
            default_period_years=("year", lambda values: int(values[(values >= DEFAULT_START_YEAR) & (values <= DEFAULT_END_YEAR)].nunique())),
        )
        .reset_index()
    )
    species_rows = []
    for row in species_summary.sort_values(["default_period_years", "default_period_catch", "total_catch"], ascending=False).itertuples(index=False):
        species_rows.append(
            {
                "species_id": row.species_id,
                "scientific_name": row.scientificName_catch,
                "display_name": row.commonName_catch,
                "original_name": row.commonName_catch,
                "total_catch": int(row.total_catch),
                "kept": int(row.kept),
                "released": int(row.released),
                "first_year": int(row.first_year),
                "last_year": int(row.last_year),
                "record_count": int(row.record_count),
                "default_period_catch": int(row.default_period_catch),
                "default_period_years": int(row.default_period_years),
            }
        )
    default_species = species_rows[0]["species_id"]

    area_effort = pd.DataFrame(coverage["area"])
    region_effort = pd.DataFrame(coverage["region"])

    area_group = (
        fish.groupby(["year", "species_id", "commonName_catch", "scientificName_catch", "area_code"], dropna=False)
        .agg(
            catch=("individualCount", "sum"),
            kept=("kept", "sum"),
            released=("released", "sum"),
            quality_flagged_records=("has_quality_flag", "sum"),
            catch_records=("individualCount", "count"),
        )
        .reset_index()
        .merge(area_effort, on=["year", "area_code"], how="left")
    )
    area_rows = aggregate_rows(area_group, area_lookup, include_area=True)

    region_group = (
        fish.groupby(["year", "species_id", "commonName_catch", "scientificName_catch", "broad_region"], dropna=False)
        .agg(
            catch=("individualCount", "sum"),
            kept=("kept", "sum"),
            released=("released", "sum"),
            quality_flagged_records=("has_quality_flag", "sum"),
            catch_records=("individualCount", "count"),
        )
        .reset_index()
        .merge(region_effort, on=["year", "broad_region"], how="left")
    )
    region_rows = aggregate_rows(region_group, area_lookup, include_area=False)
    return species_rows, area_rows, region_rows, default_species


def aggregate_rows(df: pd.DataFrame, area_lookup: dict[str, dict[str, str]], include_area: bool) -> list[dict[str, Any]]:
    rows = []
    for row in df.itertuples(index=False):
        data = row._asdict()
        catch = float(data["catch"])
        kept = float(data["kept"])
        released = float(data["released"])
        effort = data.get("effort_denominator")
        release_rate = safe_divide(released, kept + released)
        item = {
            "year": int(data["year"]),
            "species_id": data["species_id"],
            "species_name": data["commonName_catch"],
            "scientific_name": data["scientificName_catch"],
            "broad_region": data.get("broad_region") or area_region(data.get("area_code")),
            "catch": int(catch),
            "kept": int(kept),
            "released": int(released),
            "effort_denominator": round(float(effort), 4) if pd.notna(effort) else None,
            "effort_unit": "angler-hours",
            "cpue": safe_divide(catch, effort),
            "release_rate": release_rate,
            "surveyed_trips": int(data["surveyed_trips"]) if pd.notna(data.get("surveyed_trips")) else 0,
            "fishing_hours": round(float(data["fishing_hours"]), 4) if pd.notna(data.get("fishing_hours")) else None,
            "anglers": round(float(data["anglers"]), 4) if pd.notna(data.get("anglers")) else None,
            "quality_flagged_records": int(data["quality_flagged_records"]),
            "catch_records": int(data["catch_records"]),
            "months_present": int(data["months_present"]) if pd.notna(data.get("months_present")) else None,
            "is_partial_year": bool(data.get("is_partial_year")) if pd.notna(data.get("is_partial_year")) else None,
            "coverage_status": data.get("coverage_status") or "unknown",
        }
        if include_area:
            code = data["area_code"]
            info = area_lookup.get(code, {"area_name": historic_area_name(code), "broad_region": area_region(code)})
            item["area_code"] = code
            item["area_name"] = info["area_name"]
            item["broad_region"] = info["broad_region"]
        rows.append(item)
    return rows


def build_geojson(area_lookup: dict[str, dict[str, str]]) -> dict[str, Any]:
    areas = pd.read_csv(RAW_DIR / EXPECTED_FILES["area_geography"])
    transformer = Transformer.from_crs("EPSG:26917", "EPSG:4326", always_xy=True)
    features = []
    for row in areas.itertuples(index=False):
        geom = load_wkt(row.wkt)
        if not geom.is_valid:
            geom = make_valid(geom)
        geom = transform(transformer.transform, geom).simplify(0.00045, preserve_topology=True)
        code = normalize_area(row.zone)
        info = area_lookup[code]
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "area_code": code,
                    "area_name": row.zoneName,
                    "broad_region": info["broad_region"],
                    "source_crs": "EPSG:26917",
                },
                "geometry": mapping(geom),
            }
        )
    return {"type": "FeatureCollection", "features": features}


def main() -> None:
    area_lookup = load_area_lookup()
    catch_cols = [
        "interviewLocation",
        "eventDate",
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
    catch = pd.read_csv(RAW_DIR / EXPECTED_FILES["catch_effort"], usecols=catch_cols, parse_dates=["eventDate"])
    catch["scientificName_catch"] = catch["scientificName_catch"].fillna("Unknown scientific name").astype(str)
    catch["commonName_catch"] = catch["commonName_catch"].fillna(catch["scientificName_catch"]).astype(str)
    catch["year"] = catch["eventDate"].dt.year
    catch["month"] = catch["eventDate"].dt.month
    catch["area_code"] = catch["areaFished"].map(normalize_area)
    catch["area_code"] = catch["area_code"].fillna("Unknown")
    catch["broad_region"] = catch["area_code"].map(area_region)
    catch["species_id"] = [species_id(sci, common) for sci, common in zip(catch["scientificName_catch"], catch["commonName_catch"])]
    catch["is_noncatch"] = [is_noncatch_species(common, sci) for common, sci in zip(catch["commonName_catch"], catch["scientificName_catch"])]
    catch["has_quality_flag"] = catch["flags"].fillna(0) > 0
    catch["individualCount"] = pd.to_numeric(catch["individualCount"], errors="coerce").fillna(0)
    catch["disposition"] = catch["disposition"].fillna("NA")

    trailers = pd.read_csv(RAW_DIR / EXPECTED_FILES["boat_trailer_counts"], parse_dates=["eventDate"])
    coverage = build_coverage(catch, trailers, area_lookup)
    species_rows, area_rows, region_rows, default_species = build_species_and_aggregates(catch, coverage, area_lookup)
    geojson = build_geojson(area_lookup)

    metadata = {
        "title": "Everglades Fisheries Explorer",
        "source_page": SOURCE_PAGE,
        "catalog_page": CATALOG_PAGE,
        "processed_at": datetime.now(timezone.utc).isoformat(),
        "manifest": read_manifest(),
        "date_coverage": {
            "min_date": catch["eventDate"].min().date().isoformat(),
            "max_date": catch["eventDate"].max().date().isoformat(),
            "unique_years": sorted(int(year) for year in catch["year"].dropna().unique()),
            "default_start_year": DEFAULT_START_YEAR,
            "default_end_year": DEFAULT_END_YEAR,
        },
        "cpue": {
            "formula": "sum(reported catch for selected species) / sum(deduplicated interview angler-hours for the selected area and year)",
            "numerator": "individualCount for harvested and released catch records",
            "denominator": "numPeople * hoursFished after deduplicating interviews by interviewLocation, eventDate, and interviewNumber",
            "unit": "fish per angler-hour",
            "limitation": "Catch rate is an indicator from surveyed trips and is not a direct estimate of fish population.",
        },
        "regions": REGIONS,
        "default_species_id": default_species,
        "survey_sites": {
            "included": False,
            "reason": "The official source files identify interview locations but do not provide authoritative point coordinates.",
        },
        "geography": {
            "source_format": "WKT polygons",
            "source_crs": "NAD 1983 UTM Zone 17N (EPSG:26917)",
            "browser_crs": "WGS84 (EPSG:4326)",
            "geometry_note": "Fishing-area polygons represent where anglers reported fishing. No exact fish-catch locations are implied.",
        },
    }

    write_json(PUBLIC_DATA_DIR / "species.json", species_rows)
    write_json(PUBLIC_DATA_DIR / "annual_species_area.json", area_rows)
    write_json(PUBLIC_DATA_DIR / "annual_species_region.json", region_rows)
    write_json(PUBLIC_DATA_DIR / "coverage.json", coverage)
    write_json(PUBLIC_DATA_DIR / "areas.geojson", geojson)
    write_json(PUBLIC_DATA_DIR / "source_metadata.json", metadata)
    write_json(PROCESSED_DIR / "build_summary.json", {"species": len(species_rows), "area_records": len(area_rows), "region_records": len(region_rows)})
    print(f"Wrote browser data for {len(species_rows)} species; default species is {default_species}")


if __name__ == "__main__":
    main()
