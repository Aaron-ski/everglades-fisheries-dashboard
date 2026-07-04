import { formatValue, linearSlope, metricLabels, metricUnits, percentChange } from "./metrics";
import type { DisplayRecord, MetricKey } from "./types";

export function buildTakeaways(records: DisplayRecord[], metric: MetricKey, startYear: number, endYear: number): string[] {
  const period = records.filter((record) => record.year >= startYear && record.year <= endYear);
  const usable = period.filter((record) => record.value !== null && record.coverageStatus !== "sparse survey coverage");
  const statements: string[] = [];
  if (usable.length === 0) return ["No takeaway is shown because this selection has no supported data for the selected period."];

  const latestYear = Math.max(...usable.filter((record) => !record.isPartialYear).map((record) => record.year));
  const latest = usable.filter((record) => record.year === latestYear);
  if (latest.length > 1) {
    const sorted = [...latest].sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity));
    const top = sorted[0];
    const bottom = sorted[sorted.length - 1];
    if (top.value !== null && bottom.value !== null && top.label !== bottom.label) {
      statements.push(
        `${top.label} had the highest ${metricLabels[metric].toLowerCase()} in ${latestYear} (${formatValue(top.value, metric)} ${metricUnits[metric]}).`
      );
      statements.push(
        `${bottom.label} had the lowest ${metricLabels[metric].toLowerCase()} in ${latestYear} (${formatValue(bottom.value, metric)} ${metricUnits[metric]}).`
      );
    }
  }

  const totalsByYear = new Map<number, number>();
  for (const record of usable) {
    totalsByYear.set(record.year, (totalsByYear.get(record.year) ?? 0) + (record.value ?? 0));
  }
  const first = totalsByYear.get(startYear) ?? null;
  const last = totalsByYear.get(endYear) ?? totalsByYear.get(latestYear) ?? null;
  const change = percentChange(first, last);
  if (first !== null && last !== null) {
    statements.push(
      `Across selected areas, ${metricLabels[metric].toLowerCase()} was ${change.text} from ${startYear} to ${endYear}.`
    );
  }

  const latestFive = averageForRange(totalsByYear, endYear - 4, endYear);
  const previousFive = averageForRange(totalsByYear, endYear - 9, endYear - 5);
  const fiveYearChange = percentChange(previousFive, latestFive);
  if (latestFive !== null && previousFive !== null) {
    statements.push(`The latest five-year average was ${fiveYearChange.text} compared with the preceding five years.`);
  }

  const slope = linearSlope([...totalsByYear.entries()].map(([year, value]) => ({ year, value })));
  if (slope !== null) {
    const direction = slope > 0 ? "increased" : slope < 0 ? "decreased" : "was flat";
    statements.push(`The selected-period linear trend ${direction}; this is descriptive and does not imply a cause.`);
  }

  const interrupted = period.find((record) => record.coverageStatus === "interrupted survey coverage");
  if (interrupted) {
    statements.push(`${interrupted.year} has interrupted survey coverage (${interrupted.monthsPresent} months present), so compare it cautiously.`);
  }

  return statements.slice(0, 4);
}

function averageForRange(values: Map<number, number>, start: number, end: number): number | null {
  const found: number[] = [];
  for (let year = start; year <= end; year += 1) {
    const value = values.get(year);
    if (value !== undefined) found.push(value);
  }
  if (found.length < 3) return null;
  return found.reduce((sum, value) => sum + value, 0) / found.length;
}
