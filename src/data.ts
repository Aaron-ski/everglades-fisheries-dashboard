import { annualRecordToDisplay, coverageToDisplay } from "./metrics";
import type {
  AnnualAreaRecord,
  AnnualRecord,
  CoverageArea,
  CoverageRegion,
  DashboardData,
  DashboardState,
  DisplayRecord,
  Species
} from "./types";

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${import.meta.env.BASE_URL}${path}`);
  if (!response.ok) {
    throw new Error(`Failed to load ${path}: ${response.status}`);
  }
  return (await response.json()) as T;
}

export async function loadDashboardData(): Promise<DashboardData> {
  const [species, areaRecords, regionRecords, coverage, metadata, areasGeojson] = await Promise.all([
    fetchJson<DashboardData["species"]>("data/species.json"),
    fetchJson<DashboardData["areaRecords"]>("data/annual_species_area.json"),
    fetchJson<DashboardData["regionRecords"]>("data/annual_species_region.json"),
    fetchJson<DashboardData["coverage"]>("data/coverage.json"),
    fetchJson<DashboardData["metadata"]>("data/source_metadata.json"),
    fetchJson<DashboardData["areasGeojson"]>("data/areas.geojson")
  ]);
  return { species, areaRecords, regionRecords, coverage, metadata, areasGeojson };
}

export function speciesById(species: Species[]): Map<string, Species> {
  return new Map(species.map((item) => [item.species_id, item]));
}

export function recordsForState(data: DashboardData, state: DashboardState): DisplayRecord[] {
  if (state.areaMode === "detailed") {
    return detailedRecords(data.areaRecords, data.coverage.area, state);
  }
  return regionRecords(data.regionRecords, data.coverage.region, state, state.selectedRegions);
}

function regionRecords(records: AnnualRecord[], coverageRows: CoverageRegion[], state: DashboardState, regions: string[]): DisplayRecord[] {
  const catchLookup = new Map(
    records
      .filter((record) => record.species_id === state.speciesId)
      .map((record) => [`${record.year}|${record.broad_region}`, record])
  );
  return coverageRows
    .filter((row) => regions.includes(row.broad_region))
    .map((row) => {
      const catchRecord = catchLookup.get(`${row.year}|${row.broad_region}`);
      return catchRecord ? annualRecordToDisplay(catchRecord, state.metric) : coverageToDisplay(row, state.metric);
    });
}

function detailedRecords(records: AnnualAreaRecord[], coverageRows: CoverageArea[], state: DashboardState): DisplayRecord[] {
  const catchLookup = new Map(
    records
      .filter((record) => record.species_id === state.speciesId)
      .map((record) => [`${record.year}|${record.area_code}`, record])
  );
  return coverageRows
    .filter((row) => state.selectedAreas.length === 0 || state.selectedAreas.includes(row.area_code))
    .map((row) => {
      const catchRecord = catchLookup.get(`${row.year}|${row.area_code}`);
      return catchRecord ? annualRecordToDisplay(catchRecord, state.metric) : coverageToDisplay(row, state.metric);
    });
}

export function latestCompleteYear(data: DashboardData, endYear: number): number {
  const eligible = data.coverage.years
    .filter((row) => row.year <= endYear && !row.is_partial_year)
    .map((row) => row.year);
  return Math.max(...eligible);
}

export function detailedAreaOptions(data: DashboardData): Array<{ code: string; name: string; region: string }> {
  return data.coverage.area
    .filter((row) => !["1", "2", "3", "6", "Unknown"].includes(row.area_code))
    .reduce<Array<{ code: string; name: string; region: string }>>((areas, row) => {
      if (!areas.some((area) => area.code === row.area_code)) {
        areas.push({ code: row.area_code, name: row.area_name, region: row.broad_region });
      }
      return areas;
    }, [])
    .sort((a, b) => a.code.localeCompare(b.code));
}
