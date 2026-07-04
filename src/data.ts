import { metricValue } from "./metrics";
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
  const activeRegions = regions.length ? regions : [...new Set(coverageRows.map((row) => row.broad_region))];
  const catchLookup = aggregateRecords(records, state, (record) => `${record.year}|${record.broad_region}`);
  return coverageRows
    .filter((row) => activeRegions.includes(row.broad_region))
    .map((row) => coverageAndCatchToDisplay(row, catchLookup.get(`${row.year}|${row.broad_region}`), state));
}

function detailedRecords(records: AnnualAreaRecord[], coverageRows: CoverageArea[], state: DashboardState): DisplayRecord[] {
  const catchLookup = aggregateRecords(records, state, (record) => `${record.year}|${record.area_code}`);
  return coverageRows
    .filter((row) => state.selectedAreas.length === 0 || state.selectedAreas.includes(row.area_code))
    .map((row) => coverageAndCatchToDisplay(row, catchLookup.get(`${row.year}|${row.area_code}`), state));
}

type CatchAggregate = Pick<AnnualRecord, "catch" | "kept" | "released" | "quality_flagged_records" | "catch_records">;

function aggregateRecords<T extends AnnualRecord>(
  records: T[],
  state: DashboardState,
  keyFor: (record: T) => string
): Map<string, CatchAggregate> {
  const selectedSpecies = new Set(state.selectedSpeciesIds);
  return records.reduce((lookup, record) => {
    if (selectedSpecies.size > 0 && !selectedSpecies.has(record.species_id)) return lookup;
    const key = keyFor(record);
    const aggregate = lookup.get(key) ?? { catch: 0, kept: 0, released: 0, quality_flagged_records: 0, catch_records: 0 };
    aggregate.catch += record.catch;
    aggregate.kept += record.kept;
    aggregate.released += record.released;
    aggregate.quality_flagged_records += record.quality_flagged_records;
    aggregate.catch_records += record.catch_records;
    lookup.set(key, aggregate);
    return lookup;
  }, new Map<string, CatchAggregate>());
}

function coverageAndCatchToDisplay(record: CoverageRegion | CoverageArea, aggregate: CatchAggregate | undefined, state: DashboardState): DisplayRecord {
  const fishCatch = aggregate?.catch ?? 0;
  const kept = aggregate?.kept ?? 0;
  const released = aggregate?.released ?? 0;
  const dispositionTotal = kept + released;
  const base = {
    year: record.year,
    label: "area_code" in record ? `${record.area_code} - ${record.area_name}` : record.broad_region,
    areaCode: "area_code" in record ? record.area_code : undefined,
    broadRegion: record.broad_region,
    catch: fishCatch,
    kept,
    released,
    effort: record.effort_denominator,
    cpue: record.effort_denominator > 0 ? fishCatch / record.effort_denominator : null,
    releaseRate: dispositionTotal > 0 ? released / dispositionTotal : null,
    surveyedTrips: record.surveyed_trips,
    monthsPresent: record.months_present,
    isPartialYear: record.is_partial_year,
    coverageStatus: record.coverage_status,
    value: null
  };
  return { ...base, value: metricValue(base, state.metric) };
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
