import type { AreaMode, DashboardState, MetricKey, SourceMetadata } from "./types";

const metricKeys: MetricKey[] = ["cpue", "catch", "effort", "kept", "released", "release_rate"];
const areaModes: AreaMode[] = ["regions", "Florida Bay / Cape Sable", "Whitewater Bay", "Gulf Coast", "detailed"];

export function defaultState(metadata: SourceMetadata): DashboardState {
  return {
    speciesId: metadata.default_species_id,
    metric: "cpue",
    areaMode: "regions",
    detailedArea: "all",
    startYear: metadata.date_coverage.default_start_year,
    endYear: metadata.date_coverage.default_end_year
  };
}

export function stateFromUrl(metadata: SourceMetadata, search: string): DashboardState {
  const defaults = defaultState(metadata);
  const params = new URLSearchParams(search);
  const metric = params.get("metric") as MetricKey | null;
  const areaMode = params.get("area") as AreaMode | null;
  const startParam = params.get("start");
  const endParam = params.get("end");
  const startYear = startParam === null ? Number.NaN : Number(startParam);
  const endYear = endParam === null ? Number.NaN : Number(endParam);
  return {
    speciesId: params.get("species") || defaults.speciesId,
    metric: metric && metricKeys.includes(metric) ? metric : defaults.metric,
    areaMode: areaMode && areaModes.includes(areaMode) ? areaMode : defaults.areaMode,
    detailedArea: params.get("detail") || defaults.detailedArea,
    startYear: Number.isFinite(startYear) ? startYear : defaults.startYear,
    endYear: Number.isFinite(endYear) ? endYear : defaults.endYear
  };
}

export function toQuery(state: DashboardState): string {
  const params = new URLSearchParams();
  params.set("species", state.speciesId);
  params.set("metric", state.metric);
  params.set("area", state.areaMode);
  params.set("detail", state.detailedArea);
  params.set("start", String(state.startYear));
  params.set("end", String(state.endYear));
  return params.toString();
}
