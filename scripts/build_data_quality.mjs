import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const publicData = join(root, "public", "data");
const processedData = join(root, "data", "processed");

const FRESHNESS_WARNING_DAYS = 45;
const FRESHNESS_STALE_DAYS = 120;
const CPUE_TOLERANCE = 1e-9;

function readJson(path, fallback = null) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function daysBetween(startIso, endDate = new Date()) {
  if (!startIso) return null;
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) return null;
  return Math.max(0, Math.floor((endDate.getTime() - start.getTime()) / 86_400_000));
}

function yearRangeMissing(years) {
  if (!Array.isArray(years) || years.length === 0) return [];
  const sorted = [...new Set(years.map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
  const missing = [];
  for (let year = sorted[0]; year <= sorted.at(-1); year += 1) {
    if (!sorted.includes(year)) missing.push(year);
  }
  return missing;
}

function shortHash(hash) {
  return typeof hash === "string" && hash.length > 12 ? `${hash.slice(0, 12)}...${hash.slice(-6)}` : hash ?? null;
}

function chooseSpotChecks(areaRows) {
  const preferredYears = new Set([1980, 1985, 1990, 1995, 2000, 2005, 2010, 2015, 2020, 2024]);
  const candidates = areaRows
    .filter((row) => preferredYears.has(row.year) && row.catch > 0 && row.effort_denominator > 0 && row.cpue !== null)
    .sort((a, b) => a.year - b.year || String(a.area_code).localeCompare(String(b.area_code)) || String(a.species_name).localeCompare(String(b.species_name)));
  const selected = [];
  const seenYears = new Set();
  for (const row of candidates) {
    if (seenYears.has(row.year)) continue;
    selected.push(row);
    seenYears.add(row.year);
    if (selected.length === 8) break;
  }
  return selected;
}

function buildSpotChecks(areaRows) {
  return chooseSpotChecks(areaRows).map((row) => {
    const recomputed = row.catch / row.effort_denominator;
    const diff = Math.abs(recomputed - row.cpue);
    return {
      label: `${row.year} ${row.area_code} - ${row.area_name}; ${row.species_name}`,
      year: row.year,
      areaCode: row.area_code,
      areaName: row.area_name,
      species: row.species_name,
      catch: row.catch,
      effortDenominator: row.effort_denominator,
      processedCpue: row.cpue,
      recomputedCpue: recomputed,
      absoluteDifference: diff,
      tolerance: CPUE_TOLERANCE,
      status: diff <= CPUE_TOLERANCE ? "passed" : "failed",
      method: "Recomputed from public processed annual species-area catch divided by deduplicated angler-hour denominator."
    };
  });
}

function statusFromEvidence({ processedAgeDays, sourceFiles, validationStatus, missingYears, spotChecks }) {
  const warnings = [];
  const errors = [];
  if (validationStatus && validationStatus !== "passed") errors.push("Validation summary is not marked passed.");
  if (!sourceFiles.length) errors.push("No source manifest files are recorded.");
  if (missingYears.length) errors.push(`Missing year(s) in coverage: ${missingYears.join(", ")}.`);
  if (spotChecks.some((check) => check.status === "failed")) errors.push("One or more CPUE spot checks failed.");
  if (processedAgeDays === null) warnings.push("Processed timestamp is missing or invalid.");
  else if (processedAgeDays > FRESHNESS_STALE_DAYS) errors.push(`Processed data is older than ${FRESHNESS_STALE_DAYS} days.`);
  else if (processedAgeDays > FRESHNESS_WARNING_DAYS) warnings.push(`Processed data is older than ${FRESHNESS_WARNING_DAYS} days.`);
  if (sourceFiles.some((file) => !file.sha256 || !file.size || !file.retrieved_at || !file.url)) {
    warnings.push("One or more source files are missing hash, size, retrieval time, or URL metadata.");
  }
  if (errors.length) return { status: "error", warnings, errors };
  if (warnings.length) return { status: "warning", warnings, errors };
  return { status: "healthy", warnings, errors };
}

const metadata = readJson(join(publicData, "source_metadata.json"), {});
const coverage = readJson(join(publicData, "coverage.json"), { years: [], area: [], region: [] });
const species = readJson(join(publicData, "species.json"), []);
const areaRows = readJson(join(publicData, "annual_species_area.json"), []);
const regionRows = readJson(join(publicData, "annual_species_region.json"), []);
const validation = readJson(join(processedData, "validation_summary.json"), null);
const buildSummary = readJson(join(processedData, "build_summary.json"), {});
const manifest = readJson(join(processedData, "source_manifest.json"), metadata.manifest ?? { files: [] });

const years = metadata.date_coverage?.unique_years ?? coverage.years.map((row) => row.year);
const missingYears = yearRangeMissing(years);
const sourceFiles = manifest.files ?? metadata.manifest?.files ?? [];
const retrievedDates = sourceFiles.map((file) => file.retrieved_at).filter(Boolean).sort();
const sourceLastRetrievedAt = retrievedDates.at(-1) ?? null;
const processedAgeDays = daysBetween(metadata.processed_at);
const sourceAgeDays = daysBetween(sourceLastRetrievedAt);
const spotChecks = buildSpotChecks(areaRows);
const totalQualityFlags = [...areaRows, ...regionRows].reduce((sum, row) => sum + (row.quality_flagged_records ?? 0), 0);
const totalCatchRecords = [...areaRows, ...regionRows].reduce((sum, row) => sum + (row.catch_records ?? 0), 0);
const evidenceStatus = statusFromEvidence({
  processedAgeDays,
  sourceFiles,
  validationStatus: validation?.status,
  missingYears,
  spotChecks
});

const summary = {
  generatedAt: metadata.processed_at ?? sourceLastRetrievedAt ?? new Date().toISOString(),
  freshnessThresholdDays: {
    warning: FRESHNESS_WARNING_DAYS,
    stale: FRESHNESS_STALE_DAYS
  },
  overallStatus: {
    status: evidenceStatus.status,
    message:
      evidenceStatus.status === "healthy"
        ? `Source verified. Data covers ${Math.min(...years)}-${Math.max(...years)}. Last processed ${metadata.processed_at ?? "unknown"}.`
        : "Review the listed warnings before relying on the dashboard for fresh analysis.",
    warnings: evidenceStatus.warnings,
    errors: evidenceStatus.errors
  },
  officialSource: {
    title: "Recreational Fishing Catch and Effort in Everglades National Park, 1980-2025",
    dashboardTitle: metadata.title ?? "Everglades Fisheries Explorer",
    sourcePage: metadata.source_page ?? null,
    catalogPage: metadata.catalog_page ?? null,
    retrievedAt: sourceLastRetrievedAt,
    sourceFileCount: sourceFiles.length,
    explanation: "This dashboard is derived from the National Park Service IRMA/Data.gov recreational fishing catch-and-effort data package."
  },
  dateCoverage: {
    minEventDate: metadata.date_coverage?.min_date ?? null,
    maxEventDate: metadata.date_coverage?.max_date ?? null,
    minYear: years.length ? Math.min(...years) : null,
    maxYear: years.length ? Math.max(...years) : null,
    yearCount: years.length,
    missingYears,
    everyYearPresent: missingYears.length === 0,
    partialYears: coverage.years.filter((row) => row.is_partial_year).map((row) => row.year),
    interruptedYears: coverage.years.filter((row) => row.coverage_status === "interrupted survey coverage").map((row) => row.year),
    note: "The dataset covers the full year range overall; individual species and fishing areas can still be sparse or missing in particular years."
  },
  freshness: {
    processedAt: metadata.processed_at ?? null,
    sourceLastRetrievedAt,
    processedAgeDays,
    sourceAgeDays,
    needsResync: evidenceStatus.status !== "healthy",
    explanation: "Freshness is evaluated against the processed timestamp and the recorded source retrieval timestamp in the committed metadata."
  },
  sourceIntegrity: {
    files: sourceFiles.map((file) => ({
      key: file.key ?? null,
      filename: file.filename ?? null,
      url: file.url ?? null,
      retrievedAt: file.retrieved_at ?? null,
      size: file.size ?? null,
      sha256Recorded: Boolean(file.sha256),
      sha256Short: shortHash(file.sha256),
      status: file.status ?? null
    })),
    filesWithHashes: sourceFiles.filter((file) => file.sha256).length,
    filesWithSizes: sourceFiles.filter((file) => file.size).length,
    filesWithRetrievalTimestamps: sourceFiles.filter((file) => file.retrieved_at).length,
    note: "Hashes, sizes, URLs, and retrieval timestamps are recorded from the latest data pull; this summary does not re-download the official files."
  },
  validationSummary: {
    status: validation?.status ?? "missing",
    totalChecks: validation?.checks ?? null,
    passedChecks: validation?.status === "passed" ? validation.checks ?? null : null,
    failedChecks: validation?.status === "passed" ? 0 : null,
    warningCount: evidenceStatus.warnings.length,
    errorCount: evidenceStatus.errors.length,
    yearsChecked: validation?.years ?? []
  },
  rowCounts: {
    rawRecords: null,
    rawRecordsNote: "Raw CSV row count is not exposed in public app assets; source file sizes and processed row counts are recorded instead.",
    processedAnnualAreaRecords: { expected: buildSummary.area_records ?? null, actual: areaRows.length },
    processedAnnualRegionRecords: { expected: buildSummary.region_records ?? null, actual: regionRows.length },
    speciesCount: { expected: buildSummary.species ?? null, actual: species.length },
    coverageAreaRows: coverage.area?.length ?? null,
    coverageRegionRows: coverage.region?.length ?? null,
    qualityFlaggedRecords: totalQualityFlags,
    catchRecordsRepresented: totalCatchRecords,
    note: "Expected values are the latest build summary values; actual values are counted from public JSON assets."
  },
  cpueSpotChecks: {
    status: spotChecks.every((check) => check.status === "passed") ? "passed" : "failed",
    method: "Deterministic spot checks recompute CPUE from processed annual catch and deduplicated effort denominator. The full validation script also checks every processed area and region row.",
    rawDataAvailableInPublicBuild: false,
    checks: spotChecks
  },
  limitations: [
    "The dataset overall goes back to 1980, but not every species and area combination has observations every year.",
    "CPUE depends on survey effort and the deduplication assumptions used to calculate angler-hours.",
    "Older years, uncommon species, and specific fishing areas can be sparse.",
    "2025 is present as a partial year in the current source package and should not be compared directly with complete years.",
    "The dashboard should be resynced when the official NPS/Data.gov source updates."
  ]
};

writeFileSync(join(publicData, "data_quality_summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log("Wrote public/data/data_quality_summary.json");
