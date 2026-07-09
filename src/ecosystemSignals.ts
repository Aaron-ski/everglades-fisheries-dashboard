import {
  INDICATOR_COMPOSITE_ID,
  INDICATOR_SPECIES,
  type AnomalyArea,
  type AnomalyCategory,
  type AnnualSignal,
  type BaselineWindow,
  type ConditionCategory,
  type ConfidenceCategory,
  type EcosystemIndicatorId,
  type EcosystemScope,
  type HeatmapBand,
  type HeatmapCell,
  type IndicatorSpecies,
  type RecentWindow,
  type ScorecardRow,
  type SpeciesAnomaly,
  type TrendCategory
} from "./ecosystemTypes";
import type { AnnualAreaRecord, AnnualRecord, CoverageArea, CoverageRegion, CoverageYear, DashboardData } from "./types";

export const ECOSYSTEM_THRESHOLDS = {
  conditionLowPercentile: 25,
  conditionHighPercentile: 75,
  trendStableBand: 0.1,
  minimumTrendObservations: 5,
  minimumConditionYears: 8,
  minimumRollingWindows: 3,
  confidenceHighCoverage: 0.9,
  confidenceMediumCoverage: 0.7,
  minimumMediumRecentValidYears: 3,
  anomalyMinimumRecentYears: 3,
  anomalyMinimumBaselineYears: 3,
  compositeMinimumSpecies: 2
} as const;

export function mappedAreaCodesFromGeojson(geojson: GeoJSON.FeatureCollection): string[] {
  return geojson.features
    .map((feature) => String(feature.properties?.area_code ?? ""))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

export function buildScorecard(data: DashboardData, scope: EcosystemScope, startYear: number, endYear: number): ScorecardRow[] {
  const recentWindow = latestFiveCompleteYears(data.coverage.years, startYear, endYear);
  return INDICATOR_SPECIES.map((species) => {
    const annual = annualSpeciesSignals(data, species.id, scope, startYear, endYear);
    const eligibleYears = annual.filter((row) => !row.isPartialYear).length;
    const validYears = annual.filter((row) => !row.isPartialYear && row.cpue !== null).length;
    const recentRows = annual.filter((row) => recentWindow.years.includes(row.year));
    const recentValidYears = recentRows.filter((row) => row.cpue !== null && !row.isPartialYear).length;
    const current = aggregatePeriod(recentRows);
    const windows = rollingFiveYearCpue(annual);
    const canCompare = eligibleYears >= ECOSYSTEM_THRESHOLDS.minimumConditionYears && windows.length >= ECOSYSTEM_THRESHOLDS.minimumRollingWindows && current.cpue !== null;
    const percentile = canCompare ? percentileRank(windows.map((row) => row.cpue), current.cpue as number) : null;
    const condition = percentile === null ? "Insufficient Data" : conditionCategory(percentile);
    const trendResult = classifyTrend(annual, startYear, endYear);
    const confidence = classifyConfidence(annual, recentWindow);
    return {
      species,
      annual,
      currentCpue: current.cpue,
      currentCatch: current.catch,
      currentEffort: current.effort,
      percentile,
      condition,
      trend: trendResult.trend,
      normalizedTrend: trendResult.normalizedTrend,
      confidence: confidence.confidence,
      confidenceReason: confidence.reason,
      recentWindow,
      validYears,
      eligibleYears,
      recentValidYears
    };
  });
}

export function buildHeatmapCells(data: DashboardData, scope: EcosystemScope, startYear: number, endYear: number): HeatmapCell[] {
  const cells: HeatmapCell[] = [];
  for (const species of INDICATOR_SPECIES) {
    const annual = annualSpeciesSignals(data, species.id, scope, startYear, endYear);
    const distribution = annual.map((row) => row.cpue).filter((value): value is number => value !== null);
    for (const row of annual) {
      const limited = isLimitedAnnualSignal(row);
      const percentile = row.cpue === null || distribution.length === 0 ? null : percentileRank(distribution, row.cpue);
      const band = limited || percentile === null ? "Limited or missing data" : heatmapBand(percentile);
      cells.push({
        species,
        year: row.year,
        cpue: row.cpue,
        percentile,
        band,
        bandIndex: heatmapBandIndex(band),
        limited,
        catch: row.catch,
        effort: row.effort,
        surveyedTrips: row.surveyedTrips,
        coverageStatus: row.coverageStatus,
        isPartialYear: row.isPartialYear
      });
    }
  }
  return cells;
}

export function buildAnomalyWindow(coverageYears: CoverageYear[], startYear: number, endYear: number): BaselineWindow {
  const recent = latestFiveCompleteYears(coverageYears, startYear, endYear);
  return {
    ...recent,
    baselineStart: startYear,
    baselineEnd: recent.recentStart - 1
  };
}

export function buildAnomalyWindowFromRanges(coverageYears: CoverageYear[], baselineStart: number, baselineEnd: number, recentStart: number, recentEnd: number): BaselineWindow {
  const years = coverageYears
    .filter((row) => row.year >= recentStart && row.year <= recentEnd && !row.is_partial_year)
    .map((row) => row.year)
    .sort((a, b) => a - b);
  return {
    recentStart: years[0] ?? recentStart,
    recentEnd: years.at(-1) ?? recentEnd,
    years,
    excludedPartialEndYear: coverageYears.some((row) => row.year >= recentStart && row.year <= recentEnd && row.is_partial_year),
    baselineStart,
    baselineEnd
  };
}

export function buildAnomalyAreas(
  data: DashboardData,
  scope: EcosystemScope,
  startYear: number,
  endYear: number,
  indicatorId: EcosystemIndicatorId,
  customWindow?: BaselineWindow
): { window: BaselineWindow; areas: AnomalyArea[]; emptyReason: string | null } {
  const window = customWindow ?? buildAnomalyWindow(data.coverage.years, startYear, endYear);
  if (window.baselineEnd - window.baselineStart + 1 < ECOSYSTEM_THRESHOLDS.anomalyMinimumBaselineYears || window.years.length < ECOSYSTEM_THRESHOLDS.anomalyMinimumRecentYears) {
    return { window, areas: [], emptyReason: "Expand the timeline to include at least three baseline years and three recent years." };
  }
  const areaInfo = uniqueAreaInfo(data.coverage.area, scope.mappedAreaCodes);
  const activeCodes = activeAnomalyAreaCodes(areaInfo, scope);
  const areas = areaInfo.map((area) => {
    const isActive = activeCodes.includes(area.areaCode);
    const species = indicatorId === INDICATOR_COMPOSITE_ID ? INDICATOR_SPECIES : INDICATOR_SPECIES.filter((item) => item.id === indicatorId);
    const speciesAnomalies = species.map((item) => speciesAreaAnomaly(data, item, area.areaCode, window));
    const valid = speciesAnomalies.filter((item) => item.anomalyPercent !== null);
    const compositeMode = indicatorId === INDICATOR_COMPOSITE_ID;
    const usable = compositeMode ? valid.length >= ECOSYSTEM_THRESHOLDS.compositeMinimumSpecies : valid.length === 1;
    const anomalyPercent = isActive && usable ? mean(valid.map((item) => item.anomalyPercent as number)) : null;
    const category = anomalyCategory(anomalyPercent);
    const recentCpue = usable ? meanNullable(valid.map((item) => item.recentCpue)) : null;
    const baselineCpue = usable ? meanNullable(valid.map((item) => item.baselineCpue)) : null;
    const recentCatch = sum(valid.map((item) => periodForAreaSpecies(data, item.species.id, area.areaCode, window.years).catch));
    const recentEffort = sumNullable(valid.map((item) => periodForAreaSpecies(data, item.species.id, area.areaCode, window.years).effort));
    const baselineYears = range(window.baselineStart, window.baselineEnd);
    const baselineCatch = sum(valid.map((item) => periodForAreaSpecies(data, item.species.id, area.areaCode, baselineYears).catch));
    const baselineEffort = sumNullable(valid.map((item) => periodForAreaSpecies(data, item.species.id, area.areaCode, baselineYears).effort));
    const surveyedTrips = sum(valid.flatMap((item) => [
      periodForAreaSpecies(data, item.species.id, area.areaCode, window.years).surveyedTrips,
      periodForAreaSpecies(data, item.species.id, area.areaCode, baselineYears).surveyedTrips
    ]));
    const coverageWarnings = [...new Set(speciesAnomalies.map((item) => item.reason).filter((item): item is string => Boolean(item)))];
    return {
      areaCode: area.areaCode,
      areaName: area.areaName,
      broadRegion: area.broadRegion,
      recentCpue,
      baselineCpue,
      anomalyPercent,
      category,
      recentCatch,
      recentEffort,
      baselineCatch,
      baselineEffort,
      surveyedTrips,
      validContributingSpecies: valid.length,
      speciesAnomalies,
      confidence: valid.length >= 3 ? "High" : valid.length >= 2 ? "Medium" : "Low",
      coverageWarnings: isActive ? coverageWarnings : ["Outside the active area selection"],
      isActive
    } satisfies AnomalyArea;
  });
  return { window, areas, emptyReason: null };
}

export function annualSpeciesSignals(data: DashboardData, speciesId: string, scope: EcosystemScope, startYear: number, endYear: number): AnnualSignal[] {
  if (scope.areaMode === "detailed") {
    return annualSignalsFromAreaRecords(data.areaRecords, data.coverage.area, speciesId, activeDetailedAreaCodes(scope), startYear, endYear);
  }
  const activeRegions = scope.selectedRegions.length ? scope.selectedRegions : [...new Set(data.coverage.region.map((row) => row.broad_region))];
  return annualSignalsFromRegionRecords(data.regionRecords, data.coverage.region, speciesId, activeRegions, startYear, endYear);
}

export function latestFiveCompleteYears(coverageYears: CoverageYear[], startYear: number, endYear: number): RecentWindow {
  const completeYears = coverageYears
    .filter((row) => row.year >= startYear && row.year <= endYear && !row.is_partial_year)
    .map((row) => row.year)
    .sort((a, b) => a - b);
  const years = completeYears.slice(-5);
  return {
    recentStart: years[0] ?? startYear,
    recentEnd: years.at(-1) ?? endYear,
    years,
    excludedPartialEndYear: coverageYears.some((row) => row.year === endYear && row.is_partial_year)
  };
}

export function rollingFiveYearCpue(annual: AnnualSignal[]): Array<{ startYear: number; endYear: number; cpue: number }> {
  const byYear = new Map(annual.map((row) => [row.year, row]));
  const years = annual.map((row) => row.year).sort((a, b) => a - b);
  const first = years[0];
  const last = years.at(-1);
  if (first === undefined || last === undefined) return [];
  const windows: Array<{ startYear: number; endYear: number; cpue: number }> = [];
  for (let start = first; start <= last - 4; start += 1) {
    const windowYears = range(start, start + 4);
    const rows = windowYears.map((year) => byYear.get(year)).filter((row): row is AnnualSignal => Boolean(row));
    if (rows.length !== 5 || rows.some((row) => row.isPartialYear)) continue;
    const aggregate = aggregatePeriod(rows);
    if (aggregate.cpue !== null) windows.push({ startYear: start, endYear: start + 4, cpue: aggregate.cpue });
  }
  return windows;
}

export function percentileRank(values: number[], value: number): number | null {
  if (values.length === 0) return null;
  const less = values.filter((item) => item < value).length;
  const equal = values.filter((item) => item === value).length;
  return ((less + equal * 0.5) / values.length) * 100;
}

export function conditionCategory(percentile: number): ConditionCategory {
  if (percentile < ECOSYSTEM_THRESHOLDS.conditionLowPercentile) return "Below Average";
  if (percentile > ECOSYSTEM_THRESHOLDS.conditionHighPercentile) return "Above Average";
  return "Near Average";
}

export function classifyTrend(annual: AnnualSignal[], startYear: number, endYear: number): { trend: TrendCategory; normalizedTrend: number | null } {
  const valid = annual.filter((row): row is AnnualSignal & { cpue: number } => row.cpue !== null);
  const meanCpue = mean(valid.map((row) => row.cpue));
  if (valid.length < ECOSYSTEM_THRESHOLDS.minimumTrendObservations || meanCpue === 0) return { trend: "Insufficient Data", normalizedTrend: null };
  const slope = linearSlope(valid.map((row) => ({ year: row.year, value: row.cpue })));
  if (slope === null) return { trend: "Insufficient Data", normalizedTrend: null };
  const normalizedTrend = (slope * Math.max(0, endYear - startYear)) / meanCpue;
  if (normalizedTrend > ECOSYSTEM_THRESHOLDS.trendStableBand) return { trend: "Increasing", normalizedTrend };
  if (normalizedTrend < -ECOSYSTEM_THRESHOLDS.trendStableBand) return { trend: "Decreasing", normalizedTrend };
  return { trend: "Stable", normalizedTrend };
}

export function classifyConfidence(annual: AnnualSignal[], recentWindow: RecentWindow): { confidence: ConfidenceCategory; reason: string } {
  const eligible = annual.filter((row) => !row.isPartialYear);
  const valid = eligible.filter((row) => row.cpue !== null);
  const recentRows = annual.filter((row) => recentWindow.years.includes(row.year));
  const recentValid = recentRows.filter((row) => row.cpue !== null && !row.isPartialYear);
  const recentPartial = recentRows.filter((row) => row.isPartialYear).length;
  const recentInterrupted = recentRows.filter((row) => isInterrupted(row.coverageStatus)).length;
  const coverageRatio = eligible.length ? valid.length / eligible.length : 0;
  const totalTrips = sum(annual.map((row) => row.surveyedTrips));
  const totalEffort = sumNullable(annual.map((row) => row.effort));
  const reason = `${valid.length}/${eligible.length} eligible years have valid CPUE; ${recentValid.length}/${recentRows.length} recent years valid; ${totalTrips.toLocaleString()} surveyed trips; ${formatNumber(totalEffort)} angler-hours; ${recentInterrupted} interrupted recent year(s); ${recentPartial} partial recent year(s).`;
  if (coverageRatio >= ECOSYSTEM_THRESHOLDS.confidenceHighCoverage && recentRows.length === 5 && recentValid.length === 5 && recentPartial === 0 && recentInterrupted <= 1) {
    return { confidence: "High", reason };
  }
  if (coverageRatio >= ECOSYSTEM_THRESHOLDS.confidenceMediumCoverage && recentValid.length >= ECOSYSTEM_THRESHOLDS.minimumMediumRecentValidYears) {
    return { confidence: "Medium", reason };
  }
  return { confidence: "Low", reason };
}

export function heatmapBand(percentile: number): HeatmapBand {
  if (percentile < 10) return "Below 10th percentile";
  if (percentile < 25) return "10th-25th percentile";
  if (percentile < 50) return "25th-50th percentile";
  if (percentile < 75) return "50th-75th percentile";
  if (percentile < 90) return "75th-90th percentile";
  return "Above 90th percentile";
}

export function anomalyCategory(value: number | null): AnomalyCategory {
  if (value === null || Number.isNaN(value)) return "Limited data";
  if (value > 50) return "Greater than +50%";
  if (value > 25) return "+25% to +50%";
  if (value > 10) return "+10% to +25%";
  if (value >= -10) return "-10% to +10%";
  if (value >= -25) return "-25% to -10%";
  if (value >= -50) return "-50% to -25%";
  return "Less than -50%";
}

function annualSignalsFromRegionRecords(
  records: AnnualRecord[],
  coverageRows: CoverageRegion[],
  speciesId: string,
  activeRegions: string[],
  startYear: number,
  endYear: number
): AnnualSignal[] {
  const recordLookup = new Map<string, number>();
  for (const record of records) {
    if (record.species_id !== speciesId || !activeRegions.includes(record.broad_region)) continue;
    recordLookup.set(String(record.year), (recordLookup.get(String(record.year)) ?? 0) + record.catch);
  }
  const rowsByYear = groupCoverageByYear(coverageRows.filter((row) => activeRegions.includes(row.broad_region)), (row) => row.broad_region);
  return range(startYear, endYear).map((year) => signalFromCoverage(year, speciesId, rowsByYear.get(year) ?? [], recordLookup.get(String(year)) ?? 0));
}

function annualSignalsFromAreaRecords(
  records: AnnualAreaRecord[],
  coverageRows: CoverageArea[],
  speciesId: string,
  activeAreaCodes: string[],
  startYear: number,
  endYear: number
): AnnualSignal[] {
  const active = new Set(activeAreaCodes);
  const recordLookup = new Map<string, number>();
  for (const record of records) {
    if (record.species_id !== speciesId || !active.has(record.area_code)) continue;
    recordLookup.set(String(record.year), (recordLookup.get(String(record.year)) ?? 0) + record.catch);
  }
  const rowsByYear = groupCoverageByYear(coverageRows.filter((row) => active.has(row.area_code)), (row) => row.area_code);
  return range(startYear, endYear).map((year) => signalFromCoverage(year, speciesId, rowsByYear.get(year) ?? [], recordLookup.get(String(year)) ?? 0));
}

function signalFromCoverage(year: number, speciesId: string, coverageRows: Array<CoverageRegion | CoverageArea>, fishCatch: number): AnnualSignal {
  const effort = sumNullable(coverageRows.map((row) => row.effort_denominator));
  const surveyedTrips = sum(coverageRows.map((row) => row.surveyed_trips));
  const isPartialYear = coverageRows.some((row) => row.is_partial_year);
  const statuses = [...new Set(coverageRows.map((row) => row.coverage_status))];
  const coverageStatus = statuses.some(isInterrupted) ? "interrupted survey coverage" : statuses[0] ?? "no coverage";
  const contributingAreas = coverageRows.map((row) => ("area_code" in row ? row.area_code : row.broad_region));
  return {
    speciesId,
    year,
    catch: fishCatch,
    effort,
    cpue: effort !== null && effort > 0 ? fishCatch / effort : null,
    surveyedTrips,
    monthsPresent: coverageRows.length ? Math.min(...coverageRows.map((row) => row.months_present)) : null,
    isPartialYear,
    coverageStatus,
    contributingAreas
  };
}

function groupCoverageByYear<T extends CoverageArea | CoverageRegion>(rows: T[], keyFor: (row: T) => string): Map<number, T[]> {
  const seen = new Set<string>();
  const byYear = new Map<number, T[]>();
  for (const row of rows) {
    const key = `${row.year}|${keyFor(row)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const yearRows = byYear.get(row.year) ?? [];
    yearRows.push(row);
    byYear.set(row.year, yearRows);
  }
  return byYear;
}

function activeDetailedAreaCodes(scope: EcosystemScope): string[] {
  if (scope.areaMode === "detailed" && scope.selectedAreas.length) return scope.selectedAreas;
  return scope.mappedAreaCodes;
}

function activeAnomalyAreaCodes(areaInfo: Array<{ areaCode: string; broadRegion: string }>, scope: EcosystemScope): string[] {
  if (scope.areaMode === "detailed" && scope.selectedAreas.length) return scope.selectedAreas;
  if (scope.areaMode === "regions" && scope.selectedRegions.length) {
    return areaInfo.filter((area) => scope.selectedRegions.includes(area.broadRegion)).map((area) => area.areaCode);
  }
  return scope.mappedAreaCodes;
}

function uniqueAreaInfo(coverageRows: CoverageArea[], mappedAreaCodes: string[]): Array<{ areaCode: string; areaName: string; broadRegion: string }> {
  const mapped = new Set(mappedAreaCodes);
  return coverageRows
    .filter((row) => mapped.has(row.area_code))
    .reduce<Array<{ areaCode: string; areaName: string; broadRegion: string }>>((areas, row) => {
      if (!areas.some((area) => area.areaCode === row.area_code)) {
        areas.push({ areaCode: row.area_code, areaName: row.area_name, broadRegion: row.broad_region });
      }
      return areas;
    }, [])
    .sort((a, b) => a.areaCode.localeCompare(b.areaCode));
}

function speciesAreaAnomaly(data: DashboardData, species: IndicatorSpecies, areaCode: string, window: BaselineWindow): SpeciesAnomaly {
  const recent = periodForAreaSpecies(data, species.id, areaCode, window.years);
  const baseline = periodForAreaSpecies(data, species.id, areaCode, range(window.baselineStart, window.baselineEnd));
  const warnings = [...recent.warnings, ...baseline.warnings];
  if (baseline.validYears < ECOSYSTEM_THRESHOLDS.anomalyMinimumBaselineYears) return { species, recentCpue: recent.cpue, baselineCpue: baseline.cpue, anomalyPercent: null, reason: "Fewer than three valid baseline years" };
  if (recent.validYears < ECOSYSTEM_THRESHOLDS.anomalyMinimumRecentYears) return { species, recentCpue: recent.cpue, baselineCpue: baseline.cpue, anomalyPercent: null, reason: "Fewer than three valid recent years" };
  if (baseline.cpue === null || baseline.cpue === 0) return { species, recentCpue: recent.cpue, baselineCpue: baseline.cpue, anomalyPercent: null, reason: "Baseline CPUE is missing or zero" };
  if (recent.cpue === null) return { species, recentCpue: recent.cpue, baselineCpue: baseline.cpue, anomalyPercent: null, reason: "Recent CPUE is missing" };
  return {
    species,
    recentCpue: recent.cpue,
    baselineCpue: baseline.cpue,
    anomalyPercent: ((recent.cpue - baseline.cpue) / baseline.cpue) * 100,
    reason: warnings[0] ?? null
  };
}

function periodForAreaSpecies(data: DashboardData, speciesId: string, areaCode: string, years: number[]): { catch: number; effort: number | null; cpue: number | null; surveyedTrips: number; validYears: number; warnings: string[] } {
  const yearSet = new Set(years);
  const catchByYear = new Map<number, number>();
  for (const record of data.areaRecords) {
    if (record.species_id === speciesId && record.area_code === areaCode && yearSet.has(record.year)) {
      catchByYear.set(record.year, (catchByYear.get(record.year) ?? 0) + record.catch);
    }
  }
  const coverageRows = data.coverage.area.filter((row) => row.area_code === areaCode && yearSet.has(row.year));
  const effort = sumNullable(coverageRows.map((row) => row.effort_denominator));
  const fishCatch = sum([...catchByYear.values()]);
  const validYears = coverageRows.filter((row) => !row.is_partial_year && row.effort_denominator > 0).length;
  const warnings = [...new Set(coverageRows.flatMap((row) => {
    const items: string[] = [];
    if (row.is_partial_year) items.push(`${row.year} partial year`);
    if (isInterrupted(row.coverage_status)) items.push(`${row.year} interrupted coverage`);
    if (row.effort_denominator <= 0) items.push(`${row.year} missing effort`);
    return items;
  }))];
  return {
    catch: fishCatch,
    effort,
    cpue: effort !== null && effort > 0 ? fishCatch / effort : null,
    surveyedTrips: sum(coverageRows.map((row) => row.surveyed_trips)),
    validYears,
    warnings
  };
}

function aggregatePeriod(rows: AnnualSignal[]): { catch: number; effort: number | null; cpue: number | null } {
  const effort = sumNullable(rows.map((row) => row.effort));
  const fishCatch = sum(rows.map((row) => row.catch));
  return { catch: fishCatch, effort, cpue: effort !== null && effort > 0 ? fishCatch / effort : null };
}

function isLimitedAnnualSignal(row: AnnualSignal): boolean {
  return row.isPartialYear || isInterrupted(row.coverageStatus) || row.effort === null || row.effort <= 0 || row.cpue === null;
}

function heatmapBandIndex(band: HeatmapBand): number {
  return [
    "Limited or missing data",
    "Below 10th percentile",
    "10th-25th percentile",
    "25th-50th percentile",
    "50th-75th percentile",
    "75th-90th percentile",
    "Above 90th percentile"
  ].indexOf(band);
}

function linearSlope(points: Array<{ year: number; value: number }>): number | null {
  if (points.length < 2) return null;
  const meanX = mean(points.map((point) => point.year));
  const meanY = mean(points.map((point) => point.value));
  const denominator = sum(points.map((point) => (point.year - meanX) ** 2));
  if (denominator === 0) return null;
  return sum(points.map((point) => (point.year - meanX) * (point.value - meanY))) / denominator;
}

function isInterrupted(status: string): boolean {
  return status.toLowerCase().includes("interrupted");
}

function range(start: number, end: number): number[] {
  if (end < start) return [];
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function sumNullable(values: Array<number | null | undefined>): number | null {
  const valid = values.filter((value): value is number => value !== null && value !== undefined && Number.isFinite(value));
  if (valid.length === 0) return null;
  return sum(valid);
}

function mean(values: number[]): number {
  return values.length ? sum(values) / values.length : 0;
}

function meanNullable(values: Array<number | null>): number | null {
  const valid = values.filter((value): value is number => value !== null);
  return valid.length ? mean(valid) : null;
}

function formatNumber(value: number | null): string {
  return value === null ? "no" : value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}
