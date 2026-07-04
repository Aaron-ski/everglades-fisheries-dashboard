import type { AreaMode, DashboardState, MetricKey, SourceMetadata } from "./types";

const metricKeys: MetricKey[] = ["cpue", "catch", "effort", "kept", "released", "release_rate"];
const areaModes: AreaMode[] = ["regions", "detailed"];

const fallbackRegions = ["Florida Bay / Cape Sable", "Whitewater Bay", "Gulf Coast"];

export function defaultState(metadata: SourceMetadata): DashboardState {
  return {
    speciesId: metadata.default_species_id,
    metric: "cpue",
    areaMode: "regions",
    selectedRegions: [],
    selectedAreas: [],
    startYear: metadata.date_coverage.default_start_year,
    endYear: metadata.date_coverage.default_end_year
  };
}

export function stateFromUrl(metadata: SourceMetadata, search: string): DashboardState {
  const defaults = defaultState(metadata);
  const params = new URLSearchParams(search);
  const metric = params.get("metric") as MetricKey | null;
  const areaMode = params.get("area") as AreaMode | null;
  const legacyDetail = params.get("detail");
  const startParam = params.get("start");
  const endParam = params.get("end");
  const startYear = startParam === null ? Number.NaN : Number(startParam);
  const endYear = endParam === null ? Number.NaN : Number(endParam);
  const allRegions = metadata.regions?.length ? metadata.regions : fallbackRegions;
  const selectedRegions = parseList(params.get("regions")).filter((region) => allRegions.includes(region));
  const selectedAreas = parseList(params.get("areas"));
  return {
    speciesId: params.get("species") || defaults.speciesId,
    metric: metric && metricKeys.includes(metric) ? metric : defaults.metric,
    areaMode: areaMode && areaModes.includes(areaMode) ? areaMode : defaults.areaMode,
    selectedRegions: selectedRegions.length === allRegions.length ? [] : selectedRegions,
    selectedAreas: selectedAreas.length ? selectedAreas : legacyDetail && legacyDetail !== "all" ? [legacyDetail] : defaults.selectedAreas,
    startYear: Number.isFinite(startYear) ? startYear : defaults.startYear,
    endYear: Number.isFinite(endYear) ? endYear : defaults.endYear
  };
}

export function toQuery(state: DashboardState): string {
  const params = new URLSearchParams();
  params.set("species", state.speciesId);
  params.set("metric", state.metric);
  params.set("area", state.areaMode);
  if (state.selectedRegions.length) params.set("regions", state.selectedRegions.join(","));
  if (state.selectedAreas.length) params.set("areas", state.selectedAreas.join(","));
  params.set("start", String(state.startYear));
  params.set("end", String(state.endYear));
  return params.toString();
}

function parseList(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
