export type MetricKey = "cpue" | "catch" | "effort" | "kept" | "released" | "release_rate";

export type AreaMode = "regions" | "detailed";

export interface Species {
  species_id: string;
  scientific_name: string;
  display_name: string;
  original_name: string;
  total_catch: number;
  kept: number;
  released: number;
  first_year: number;
  last_year: number;
  record_count: number;
  default_period_catch: number;
  default_period_years: number;
}

export interface AnnualRecord {
  year: number;
  species_id: string;
  species_name: string;
  scientific_name: string;
  broad_region: string;
  catch: number;
  kept: number;
  released: number;
  effort_denominator: number | null;
  effort_unit: string;
  cpue: number | null;
  release_rate: number | null;
  surveyed_trips: number;
  fishing_hours: number | null;
  anglers: number | null;
  quality_flagged_records: number;
  catch_records: number;
  months_present: number | null;
  is_partial_year: boolean | null;
  coverage_status: string;
}

export interface AnnualAreaRecord extends AnnualRecord {
  area_code: string;
  area_name: string;
}

export interface CoverageArea {
  year: number;
  area_code: string;
  area_name: string;
  broad_region: string;
  months_present: number;
  is_partial_year: boolean;
  coverage_status: string;
  surveyed_trips: number;
  effort_denominator: number;
  effort_unit: string;
  fishing_hours: number;
  anglers: number;
  missing_effort_trips: number;
}

export interface CoverageRegion {
  year: number;
  broad_region: string;
  months_present: number;
  is_partial_year: boolean;
  coverage_status: string;
  surveyed_trips: number;
  effort_denominator: number;
  effort_unit: string;
  fishing_hours: number;
  anglers: number;
  missing_effort_trips: number;
}

export interface CoverageYear {
  year: number;
  months_present: number;
  is_partial_year: boolean;
  survey_count: number;
  coverage_status: string;
}

export interface Coverage {
  years: CoverageYear[];
  area: CoverageArea[];
  region: CoverageRegion[];
  trailer_counts: Array<{ year: number; parking_lot: string; trailer_count: number; trailer_days: number }>;
}

export interface SourceMetadata {
  processed_at: string;
  source_page: string;
  catalog_page: string;
  date_coverage: {
    min_date: string;
    max_date: string;
    unique_years: number[];
    default_start_year: number;
    default_end_year: number;
  };
  cpue: {
    formula: string;
    numerator: string;
    denominator: string;
    unit: string;
    limitation: string;
  };
  regions: string[];
  default_species_id: string;
  survey_sites: { included: boolean; reason: string };
  geography: {
    source_format: string;
    source_crs: string;
    browser_crs: string;
    geometry_note: string;
  };
}

export interface DashboardData {
  species: Species[];
  areaRecords: AnnualAreaRecord[];
  regionRecords: AnnualRecord[];
  coverage: Coverage;
  metadata: SourceMetadata;
  areasGeojson: GeoJSON.FeatureCollection;
  dataQuality: DataQualitySummary | null;
}

export interface DashboardState {
  selectedSpeciesIds: string[];
  metric: MetricKey;
  areaMode: AreaMode;
  selectedRegions: string[];
  selectedAreas: string[];
  startYear: number;
  endYear: number;
}

export interface DisplayRecord {
  year: number;
  label: string;
  areaCode?: string;
  broadRegion: string;
  value: number | null;
  catch: number;
  kept: number;
  released: number;
  effort: number | null;
  cpue: number | null;
  releaseRate: number | null;
  surveyedTrips: number;
  monthsPresent: number | null;
  isPartialYear: boolean | null;
  coverageStatus: string;
}

export type DataQualityStatus = "healthy" | "warning" | "stale" | "error" | "missing" | "passed" | "failed";

export interface DataQualitySummary {
  generatedAt?: string;
  freshnessThresholdDays?: { warning?: number; stale?: number };
  overallStatus?: {
    status?: DataQualityStatus;
    message?: string;
    warnings?: string[];
    errors?: string[];
  };
  officialSource?: {
    title?: string;
    dashboardTitle?: string;
    sourcePage?: string | null;
    catalogPage?: string | null;
    retrievedAt?: string | null;
    sourceFileCount?: number;
    explanation?: string;
  };
  dateCoverage?: {
    minEventDate?: string | null;
    maxEventDate?: string | null;
    minYear?: number | null;
    maxYear?: number | null;
    yearCount?: number;
    missingYears?: number[];
    everyYearPresent?: boolean;
    partialYears?: number[];
    interruptedYears?: number[];
    note?: string;
  };
  freshness?: {
    processedAt?: string | null;
    sourceLastRetrievedAt?: string | null;
    processedAgeDays?: number | null;
    sourceAgeDays?: number | null;
    needsResync?: boolean;
    explanation?: string;
  };
  sourceIntegrity?: {
    files?: Array<{
      key?: string | null;
      filename?: string | null;
      url?: string | null;
      retrievedAt?: string | null;
      size?: number | null;
      sha256Recorded?: boolean;
      sha256Short?: string | null;
      status?: string | number | null;
    }>;
    filesWithHashes?: number;
    filesWithSizes?: number;
    filesWithRetrievalTimestamps?: number;
    note?: string;
  };
  validationSummary?: {
    status?: DataQualityStatus;
    totalChecks?: number | null;
    passedChecks?: number | null;
    failedChecks?: number | null;
    warningCount?: number;
    errorCount?: number;
    yearsChecked?: number[];
  };
  rowCounts?: {
    rawRecords?: number | null;
    rawRecordsNote?: string;
    processedAnnualAreaRecords?: { expected?: number | null; actual?: number | null };
    processedAnnualRegionRecords?: { expected?: number | null; actual?: number | null };
    speciesCount?: { expected?: number | null; actual?: number | null };
    coverageAreaRows?: number | null;
    coverageRegionRows?: number | null;
    qualityFlaggedRecords?: number | null;
    catchRecordsRepresented?: number | null;
    note?: string;
  };
  cpueSpotChecks?: {
    status?: DataQualityStatus;
    method?: string;
    rawDataAvailableInPublicBuild?: boolean;
    checks?: Array<{
      label?: string;
      year?: number;
      areaCode?: string;
      areaName?: string;
      species?: string;
      catch?: number;
      effortDenominator?: number;
      processedCpue?: number;
      recomputedCpue?: number;
      absoluteDifference?: number;
      tolerance?: number;
      status?: DataQualityStatus;
      method?: string;
    }>;
  };
  limitations?: string[];
}
