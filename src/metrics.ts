import type { AnnualAreaRecord, AnnualRecord, CoverageArea, CoverageRegion, DisplayRecord, MetricKey } from "./types";

export const metricLabels: Record<MetricKey, string> = {
  cpue: "Catch rate",
  catch: "Total reported catch",
  effort: "Fishing effort",
  kept: "Fish kept",
  released: "Fish released",
  release_rate: "Release rate"
};

export const metricUnits: Record<MetricKey, string> = {
  cpue: "fish per angler-hour",
  catch: "fish",
  effort: "angler-hours",
  kept: "fish",
  released: "fish",
  release_rate: "%"
};

export function metricValue(record: Pick<DisplayRecord, "cpue" | "catch" | "effort" | "kept" | "released" | "releaseRate">, metric: MetricKey): number | null {
  switch (metric) {
    case "cpue":
      return record.cpue;
    case "catch":
      return record.catch;
    case "effort":
      return record.effort;
    case "kept":
      return record.kept;
    case "released":
      return record.released;
    case "release_rate":
      return record.releaseRate;
  }
}

export function formatValue(value: number | null | undefined, metric: MetricKey, compact = false): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "No data";
  if (metric === "release_rate") return `${(value * 100).toFixed(1)}%`;
  if (metric === "cpue") return value.toFixed(3);
  return compact
    ? Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value)
    : Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

export function percentChange(start: number | null, end: number | null): { text: string; value: number | null } {
  if (start === null || end === null) return { text: "comparison unavailable", value: null };
  if (start === 0 && end === 0) return { text: "no change from zero", value: null };
  if (start === 0) return { text: "increased from zero", value: null };
  const change = (end - start) / Math.abs(start);
  const direction = change >= 0 ? "up" : "down";
  return { text: `${direction} ${(Math.abs(change) * 100).toFixed(1)}%`, value: change };
}

export function linearSlope(points: Array<{ year: number; value: number | null }>): number | null {
  const valid = points.filter((point) => point.value !== null) as Array<{ year: number; value: number }>;
  if (valid.length < 2) return null;
  const meanX = valid.reduce((sum, point) => sum + point.year, 0) / valid.length;
  const meanY = valid.reduce((sum, point) => sum + point.value, 0) / valid.length;
  const denominator = valid.reduce((sum, point) => sum + (point.year - meanX) ** 2, 0);
  if (denominator === 0) return null;
  return valid.reduce((sum, point) => sum + (point.year - meanX) * (point.value - meanY), 0) / denominator;
}

export function annualRecordToDisplay(record: AnnualRecord | AnnualAreaRecord, metric: MetricKey): DisplayRecord {
  const label = "area_code" in record ? `${record.area_code} - ${record.area_name}` : record.broad_region;
  const base = {
    year: record.year,
    label,
    areaCode: "area_code" in record ? record.area_code : undefined,
    broadRegion: record.broad_region,
    catch: record.catch,
    kept: record.kept,
    released: record.released,
    effort: record.effort_denominator,
    cpue: record.cpue,
    releaseRate: record.release_rate,
    surveyedTrips: record.surveyed_trips,
    monthsPresent: record.months_present,
    isPartialYear: record.is_partial_year,
    coverageStatus: record.coverage_status,
    value: null
  };
  return { ...base, value: metricValue(base, metric) };
}

export function coverageToDisplay(record: CoverageRegion | CoverageArea, metric: MetricKey): DisplayRecord {
  const base = {
    year: record.year,
    label: "area_code" in record ? `${record.area_code} - ${record.area_name}` : record.broad_region,
    areaCode: "area_code" in record ? record.area_code : undefined,
    broadRegion: record.broad_region,
    catch: 0,
    kept: 0,
    released: 0,
    effort: record.effort_denominator,
    cpue: record.effort_denominator > 0 ? 0 : null,
    releaseRate: null,
    surveyedTrips: record.surveyed_trips,
    monthsPresent: record.months_present,
    isPartialYear: record.is_partial_year,
    coverageStatus: record.coverage_status,
    value: null
  };
  return { ...base, value: metricValue(base, metric) };
}

export function selectedPeriod(records: DisplayRecord[], startYear: number, endYear: number): DisplayRecord[] {
  return records.filter((record) => record.year >= startYear && record.year <= endYear);
}
