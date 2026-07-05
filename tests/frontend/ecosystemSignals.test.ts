import { describe, expect, it } from "vitest";
import {
  buildAnomalyAreas,
  buildAnomalyWindow,
  buildHeatmapCells,
  buildScorecard,
  conditionCategory,
  latestFiveCompleteYears,
  mappedAreaCodesFromGeojson,
  percentileRank,
  rollingFiveYearCpue,
  annualSpeciesSignals
} from "../../src/ecosystemSignals";
import { INDICATOR_COMPOSITE_ID, INDICATOR_SPECIES, type EcosystemScope } from "../../src/ecosystemTypes";
import type { AnnualAreaRecord, AnnualRecord, CoverageArea, CoverageRegion, DashboardData } from "../../src/types";

const years = Array.from({ length: 21 }, (_, index) => 2005 + index);
const [snook, redDrum, seatrout, graySnapper] = INDICATOR_SPECIES;

function mockData(): DashboardData {
  const coverageYears = years.map((year) => ({
    year,
    months_present: year === 2025 ? 4 : year === 2020 ? 10 : 12,
    is_partial_year: year === 2025,
    survey_count: 2,
    coverage_status: year === 2020 ? "interrupted survey coverage" : "complete"
  }));
  const regionCoverage: CoverageRegion[] = years.flatMap((year) => [
    coverageRegion(year, "Florida Bay / Cape Sable", 10),
    coverageRegion(year, "Gulf Coast", 10)
  ]);
  const areaCoverage: CoverageArea[] = years.flatMap((year) => [
    coverageArea(year, "A1", "Area 1", "Florida Bay / Cape Sable", 10),
    coverageArea(year, "A2", "Area 2", "Gulf Coast", 10)
  ]);
  return {
    species: [],
    regionRecords: years.flatMap((year) => [
      annualRegion(year, snook.id, "Florida Bay / Cape Sable", year - 2000),
      annualRegion(year, snook.id, "Gulf Coast", 2),
      annualRegion(year, redDrum.id, "Florida Bay / Cape Sable", year >= 2020 && year <= 2024 ? 20 : 10),
      annualRegion(year, seatrout.id, "Florida Bay / Cape Sable", year >= 2020 && year <= 2024 ? 4 : 5),
      annualRegion(year, graySnapper.id, "Florida Bay / Cape Sable", 0)
    ]),
    areaRecords: years.flatMap((year) => [
      annualArea(year, snook.id, "A1", "Area 1", "Florida Bay / Cape Sable", year - 2000),
      annualArea(year, snook.id, "A2", "Area 2", "Gulf Coast", 2),
      annualArea(year, redDrum.id, "A1", "Area 1", "Florida Bay / Cape Sable", year >= 2020 && year <= 2024 ? 20 : 10),
      annualArea(year, seatrout.id, "A1", "Area 1", "Florida Bay / Cape Sable", year >= 2020 && year <= 2024 ? 4 : 5),
      annualArea(year, graySnapper.id, "A1", "Area 1", "Florida Bay / Cape Sable", 0)
    ]),
    coverage: { years: coverageYears, area: areaCoverage, region: regionCoverage, trailer_counts: [] },
    metadata: {
      processed_at: "2026-01-01",
      source_page: "",
      catalog_page: "",
      date_coverage: { min_date: "2005-01-01", max_date: "2025-04-01", unique_years: years, default_start_year: 2005, default_end_year: 2024 },
      cpue: { formula: "", numerator: "", denominator: "", unit: "", limitation: "" },
      regions: ["Florida Bay / Cape Sable", "Gulf Coast"],
      default_species_id: snook.id,
      survey_sites: { included: false, reason: "" },
      geography: { source_format: "", source_crs: "", browser_crs: "", geometry_note: "" }
    },
    areasGeojson: {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { area_code: "A1", area_name: "Area 1" }, geometry: { type: "Polygon", coordinates: [] } },
        { type: "Feature", properties: { area_code: "A2", area_name: "Area 2" }, geometry: { type: "Polygon", coordinates: [] } }
      ]
    }
  } as DashboardData;
}

const baseScope: EcosystemScope = {
  areaMode: "regions",
  selectedRegions: [],
  selectedAreas: [],
  mappedAreaCodes: ["A1", "A2"]
};

describe("ecosystem signal calculations", () => {
  it("aggregates species annual CPUE without duplicating shared coverage effort", () => {
    const rows = annualSpeciesSignals(mockData(), snook.id, baseScope, 2005, 2005);
    expect(rows[0]).toMatchObject({ catch: 7, effort: 20, cpue: 0.35, surveyedTrips: 2 });
  });

  it("respects active broad-region and detailed-area filters", () => {
    const data = mockData();
    const gulf = annualSpeciesSignals(data, snook.id, { ...baseScope, selectedRegions: ["Gulf Coast"] }, 2005, 2005);
    expect(gulf[0]).toMatchObject({ catch: 2, effort: 10, cpue: 0.2 });
    const detailed = annualSpeciesSignals(data, snook.id, { ...baseScope, areaMode: "detailed", selectedAreas: ["A1"] }, 2005, 2005);
    expect(detailed[0]).toMatchObject({ catch: 5, effort: 10, cpue: 0.5 });
  });

  it("selects the latest five complete years and excludes partial 2025", () => {
    const window = latestFiveCompleteYears(mockData().coverage.years, 2005, 2025);
    expect(window.years).toEqual([2020, 2021, 2022, 2023, 2024]);
    expect(window.recentEnd).toBe(2024);
    expect(window.excludedPartialEndYear).toBe(true);
  });

  it("builds the dynamic anomaly baseline before the recent window", () => {
    expect(buildAnomalyWindow(mockData().coverage.years, 2005, 2024)).toMatchObject({
      recentStart: 2020,
      recentEnd: 2024,
      baselineStart: 2005,
      baselineEnd: 2019
    });
  });

  it("calculates rolling five-year CPUE windows and percentile ties", () => {
    const annual = annualSpeciesSignals(mockData(), snook.id, baseScope, 2005, 2024);
    expect(rollingFiveYearCpue(annual)).toHaveLength(16);
    expect(percentileRank([1, 2, 2, 4], 2)).toBe(50);
  });

  it("classifies condition boundaries consistently", () => {
    expect(conditionCategory(24.99)).toBe("Below Average");
    expect(conditionCategory(25)).toBe("Near Average");
    expect(conditionCategory(75)).toBe("Near Average");
    expect(conditionCategory(75.01)).toBe("Above Average");
  });

  it("builds scorecard trend and confidence labels", () => {
    const scorecard = buildScorecard(mockData(), baseScope, 2005, 2024);
    const snookRow = scorecard.find((row) => row.species.id === snook.id);
    expect(snookRow?.trend).toBe("Increasing");
    expect(snookRow?.confidence).toBe("High");
    expect(snookRow?.condition).not.toBe("Insufficient Data");
  });

  it("marks limited heatmap cells for interrupted coverage while retaining tooltip metrics", () => {
    const cells = buildHeatmapCells(mockData(), baseScope, 2005, 2024);
    const interrupted = cells.find((cell) => cell.species.id === snook.id && cell.year === 2020);
    expect(interrupted).toMatchObject({ limited: true, band: "Limited or missing data" });
    expect(interrupted?.cpue).not.toBeNull();
  });

  it("calculates anomaly values, zero-baseline handling, and composites", () => {
    const data = mockData();
    const red = buildAnomalyAreas(data, baseScope, 2005, 2024, redDrum.id).areas.find((area) => area.areaCode === "A1");
    expect(red?.anomalyPercent).toBeCloseTo(100);
    const gray = buildAnomalyAreas(data, baseScope, 2005, 2024, graySnapper.id).areas.find((area) => area.areaCode === "A1");
    expect(gray?.category).toBe("Limited data");
    expect(gray?.speciesAnomalies[0].reason).toContain("Baseline CPUE");
    const composite = buildAnomalyAreas(data, baseScope, 2005, 2024, INDICATOR_COMPOSITE_ID).areas.find((area) => area.areaCode === "A1");
    expect(composite?.validContributingSpecies).toBe(3);
    expect(composite?.anomalyPercent).not.toBeNull();
  });

  it("requires enough baseline and recent years for anomaly mapping", () => {
    const result = buildAnomalyAreas(mockData(), baseScope, 2020, 2024, INDICATOR_COMPOSITE_ID);
    expect(result.areas).toEqual([]);
    expect(result.emptyReason).toContain("three baseline years");
  });

  it("extracts mapped area codes from official geography", () => {
    expect(mappedAreaCodesFromGeojson(mockData().areasGeojson)).toEqual(["A1", "A2"]);
  });
});

function coverageRegion(year: number, broadRegion: string, effort: number): CoverageRegion {
  return {
    year,
    broad_region: broadRegion,
    months_present: year === 2025 ? 4 : year === 2020 ? 10 : 12,
    is_partial_year: year === 2025,
    coverage_status: year === 2020 ? "interrupted survey coverage" : "complete",
    surveyed_trips: 1,
    effort_denominator: effort,
    effort_unit: "angler-hours",
    fishing_hours: effort,
    anglers: 1,
    missing_effort_trips: 0
  };
}

function coverageArea(year: number, areaCode: string, areaName: string, broadRegion: string, effort: number): CoverageArea {
  return {
    ...coverageRegion(year, broadRegion, effort),
    area_code: areaCode,
    area_name: areaName
  };
}

function annualRegion(year: number, speciesId: string, broadRegion: string, fishCatch: number): AnnualRecord {
  return {
    year,
    species_id: speciesId,
    species_name: speciesId,
    scientific_name: speciesId,
    broad_region: broadRegion,
    catch: fishCatch,
    kept: 0,
    released: 0,
    effort_denominator: null,
    effort_unit: "angler-hours",
    cpue: null,
    release_rate: null,
    surveyed_trips: 0,
    fishing_hours: null,
    anglers: null,
    quality_flagged_records: 0,
    catch_records: 1,
    months_present: null,
    is_partial_year: false,
    coverage_status: "complete"
  };
}

function annualArea(year: number, speciesId: string, areaCode: string, areaName: string, broadRegion: string, fishCatch: number): AnnualAreaRecord {
  return {
    ...annualRegion(year, speciesId, broadRegion, fishCatch),
    area_code: areaCode,
    area_name: areaName
  };
}
