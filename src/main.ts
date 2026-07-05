import "leaflet/dist/leaflet.css";
import "./styles/main.css";
import { renderEffortChart, renderKeptReleasedChart, renderTrendChart, summarizeChart } from "./charts";
import { detailedAreaOptions, latestCompleteYear, loadDashboardData, recordsForState } from "./data";
import { renderEcosystemHeatmap, heatmapCellKey } from "./ecosystemCharts";
import { EcosystemAnomalyMap, colorForAnomaly, indicatorLabel } from "./ecosystemMap";
import { buildAnomalyAreas, buildHeatmapCells, latestFiveCompleteYears, mappedAreaCodesFromGeojson } from "./ecosystemSignals";
import {
  INDICATOR_COMPOSITE_ID,
  INDICATOR_SPECIES,
  type AnomalyArea,
  type BaselineWindow,
  type EcosystemIndicatorId,
  type EcosystemScope,
  type HeatmapCell
} from "./ecosystemTypes";
import { FisheriesMap } from "./mapView";
import { formatValue, metricLabels, metricUnits, percentChange, selectedPeriod } from "./metrics";
import { defaultState, stateFromUrl, toQuery } from "./state";
import type { DashboardData, DashboardState, DisplayRecord, MetricKey } from "./types";

const appElement = document.querySelector<HTMLDivElement>("#app");
if (!appElement) throw new Error("Missing #app");
const app = appElement;

let data: DashboardData;
let state: DashboardState;
let fisheriesMap: FisheriesMap | null = null;
let ecosystemAnomalyMap: EcosystemAnomalyMap | null = null;
let ecosystemIndicator: EcosystemIndicatorId = INDICATOR_COMPOSITE_ID;
let selectedHeatmapCellKey: string | null = null;

void init();

async function init(): Promise<void> {
  app.innerHTML = '<main class="loading">Loading Everglades fisheries data...</main>';
  try {
    data = await loadDashboardData();
    state = stateFromUrl(data.metadata, window.location.search);
    renderShell();
    bindControls();
    update();
  } catch (error) {
    app.innerHTML = `<main class="error-state"><h1>Data failed to load</h1><p>${error instanceof Error ? error.message : "Unknown error"}</p></main>`;
  }
}

function renderShell(): void {
  const processed = new Date(data.metadata.processed_at).toLocaleDateString();
  const minYear = data.metadata.date_coverage.unique_years[0];
  const maxYear = data.metadata.date_coverage.unique_years.at(-1) ?? data.metadata.date_coverage.default_end_year;
  const areaOptions = detailedAreaOptions(data);
  app.innerHTML = `
    <header class="site-header">
      <div class="header-brand">
        <img class="nps-logo" src="${import.meta.env.BASE_URL}images/nps-logo.jpg" alt="National Park Service logo" />
        <div>
          <p class="eyebrow">National Park Service public data</p>
          <h1>Everglades Fisheries Explorer</h1>
          <p class="subtitle">Twenty years of recreational fishing trends in Everglades National Park</p>
        </div>
      </div>
      <div class="header-meta">
        <span>Last processed ${processed}</span>
        <a href="${data.metadata.source_page}" target="_blank" rel="noreferrer">Official source</a>
      </div>
    </header>
    <main id="main">
      <details class="filters-panel">
        <summary>Dashboard filters</summary>
        <section class="filters" aria-label="Dashboard filters">
          <div id="speciesPicker" class="filter-field species-picker">
            <span class="field-label">Species</span>
            <div class="species-combobox">
              <input id="speciesSearchInput" type="search" role="combobox" aria-expanded="false" aria-controls="speciesDropdown" placeholder="All species" autocomplete="off" />
              <span id="speciesSummary" class="species-summary">All species</span>
              <div id="speciesDropdown" class="species-dropdown" hidden></div>
            </div>
          </div>
          <label>Metric
            <select id="metricSelect">
              ${Object.entries(metricLabels).map(([key, label]) => `<option value="${key}">${label}</option>`).join("")}
            </select>
          </label>
          <label>Area
            <select id="areaModeSelect">
              <option value="regions">Broad regions</option>
              <option value="detailed">Detailed coded fishing areas</option>
            </select>
          </label>
          <fieldset id="regionFilterWrap" class="multi-filter">
            <legend>Broad regions</legend>
            ${data.metadata.regions.map((region) => `
              <label class="check-option">
                <input type="checkbox" name="regionFilter" value="${escapeHtml(region)}" />
                <span>${escapeHtml(region)}</span>
              </label>
            `).join("")}
          </fieldset>
          <fieldset id="detailedAreaWrap" class="multi-filter">
            <legend>Detailed areas</legend>
            <div class="area-check-grid">
              ${areaOptions.map((area) => `
                <label class="check-option">
                  <input type="checkbox" name="areaFilter" value="${area.code}" />
                  <span>${area.code} - ${escapeHtml(area.name)}</span>
                </label>
              `).join("")}
            </div>
          </fieldset>
          <div class="timeline-filter" aria-label="Year timeline filter">
            <div class="timeline-heading">
              <span>Year range</span>
              <strong id="yearRangeLabel">${state.startYear}-${state.endYear}</strong>
            </div>
            <div class="timeline-track">
              <input id="startYearRange" aria-label="Start year" type="range" min="${minYear}" max="${maxYear}" step="1" />
              <input id="endYearRange" aria-label="End year" type="range" min="${minYear}" max="${maxYear}" step="1" />
            </div>
            <div class="timeline-scale" aria-hidden="true">
              ${[1980, 1990, 2000, 2010, 2020, 2025].filter((year) => year >= minYear && year <= maxYear).map((year) => `<span>${year}</span>`).join("")}
            </div>
          </div>
          <button id="resetButton" type="button">Reset</button>
        </section>
      </details>
      <section id="warnings" class="warnings" aria-live="polite"></section>
      <section class="panel map-panel">
        <div class="section-heading">
          <h2>Fishing-area map</h2>
          <p>Fishing-area polygons represent where anglers reported fishing. Point markers are omitted because the source package does not provide authoritative coordinates.</p>
        </div>
        <div class="map-actions">
          <button id="showAllAreasButton" type="button">Show all areas</button>
          <span class="legend"><span class="legend-missing"></span> missing data <span class="legend-zero"></span> zero value <span class="legend-fill"></span> higher value</span>
        </div>
        <div id="map" class="map" aria-label="Interactive map of Everglades fishing areas"></div>
        <div id="mapTable" class="map-table"></div>
      </section>
      <section class="panel ecosystem-section" aria-labelledby="ecosystemTitle">
        <div class="section-heading">
          <div>
            <h2 id="ecosystemTitle">Coastal Ecosystem Signals</h2>
            <p>These indicators use recreational catch rates to show changes in coastal fishery condition. They are not direct estimates of fish population size or overall ecosystem health.</p>
          </div>
          <p class="ecosystem-note">This section always evaluates Common Snook, Red Drum, Spotted Seatrout, and Gray Snapper, regardless of the global species filter.</p>
        </div>
        <div id="ecosystemPartialNote" class="ecosystem-partial-note" hidden></div>
        <div class="ecosystem-visual heatmap-visual">
          <div class="section-heading compact-heading">
            <h3>Species-by-Year Condition Heatmap</h3>
            <p id="heatmapSubtitle"></p>
          </div>
          <div class="heatmap-scroll">
            <div id="ecosystemHeatmap" class="ecosystem-heatmap" role="img" aria-label="Species by year condition heatmap"></div>
          </div>
          <div id="heatmapLegend" class="ecosystem-legend"></div>
          <div id="heatmapDetail" class="heatmap-detail" aria-live="polite"></div>
          <p class="ecosystem-caption">Each cell compares that species' annual catch rate with its own catch-rate history during the selected timeline; it does not compare CPUE magnitudes across different species.</p>
        </div>
        <div class="ecosystem-visual anomaly-visual">
          <div class="section-heading">
            <div>
              <h3>Where Conditions Are Changing</h3>
              <p id="anomalySubtitle"></p>
            </div>
            <label class="compact-select">Indicator
              <select id="ecosystemIndicatorSelect" aria-label="Anomaly map indicator">
                <option value="${INDICATOR_COMPOSITE_ID}">Indicator-species composite</option>
                ${INDICATOR_SPECIES.map((species) => `<option value="${species.id}">${escapeHtml(species.commonName)}</option>`).join("")}
              </select>
            </label>
          </div>
          <div class="map-actions">
            <button id="showAllEcosystemAreasButton" type="button">Show all areas</button>
            <span id="anomalyLegend" class="legend anomaly-legend"></span>
          </div>
          <div id="anomalyEmptyState" class="empty-state" hidden></div>
          <div id="ecosystemAnomalyMap" class="map ecosystem-map" aria-label="Interactive map of coastal ecosystem condition anomalies"></div>
          <p class="ecosystem-caption">Positive anomalies mean recent surveyed catch rates were higher than the selected historical baseline. Negative anomalies mean they were lower. These differences can reflect ecological conditions, fishing behavior, regulations, access, and survey coverage.</p>
          <div id="anomalyTable" class="map-table"></div>
        </div>
      </section>
      <section id="cards" class="cards" aria-label="Key metrics"></section>
      <section class="panel">
        <div class="section-heading">
          <h2>Annual trend</h2>
          <p id="trendSummary"></p>
        </div>
        <div id="trendChart" class="chart" role="img" aria-label="Annual trend chart"></div>
      </section>
      <section class="split">
        <div class="panel">
          <h2>Fishing effort</h2>
          <p>Effort uses angler-hours from surveyed trips. Trailer counts are separate and are not part of CPUE.</p>
          <div id="effortChart" class="chart compact-chart" role="img" aria-label="Fishing effort chart"></div>
        </div>
        <div class="panel">
          <h2>Kept versus released</h2>
          <p>Harvested and released counts are shown only where the source disposition field supports them.</p>
          <div id="keptChart" class="chart compact-chart" role="img" aria-label="Kept and released chart"></div>
        </div>
      </section>
      <details class="help">
        <summary>How to use this dashboard</summary>
        <p>Pick one or more species, metric, area view, and year range. The charts, maps, cards, and ecosystem signals update together. Use Reset to return to ${data.metadata.date_coverage.default_start_year}-${data.metadata.date_coverage.default_end_year}, catch rate, all species, and all broad regions.</p>
      </details>
      <details class="methodology">
        <summary>Methodology and source</summary>
        <div>
          <p><strong>Dataset:</strong> Recreational fishing catch and effort in Everglades National Park, 1980-2025, from the National Park Service IRMA data package.</p>
          <p><strong>Coverage:</strong> ${data.metadata.date_coverage.min_date} through ${data.metadata.date_coverage.max_date}. The default view is ${data.metadata.date_coverage.default_start_year}-${data.metadata.date_coverage.default_end_year}; 2025 is selectable but marked partial.</p>
          <p><strong>CPUE:</strong> ${data.metadata.cpue.formula}. Unit: ${data.metadata.cpue.unit}. ${data.metadata.cpue.limitation}</p>
          <p><strong>Coastal ecosystem signals:</strong> Common Snook, Red Drum, Spotted Seatrout, and Gray Snapper are fixed fishery-condition indicators. They use surveyed catch rate and reported catch as coastal fishery signals, not as a comprehensive ecosystem-health score or direct fish-population estimate.</p>
          <p><strong>Heatmap method:</strong> Each species-year cell ranks annual CPUE against that species' own selected-timeline distribution. Partial years, interrupted coverage, missing effort, and missing observations are marked as limited data even when a CPUE value can still be displayed.</p>
          <p><strong>Anomaly map method:</strong> The map compares recent five-year CPUE with the selected historical baseline before that window. For the default timeline, the recent window is 2020-2024 and the baseline is 2005-2019. Species anomalies use ((recent CPUE - baseline CPUE) / baseline CPUE) * 100 and require at least three valid recent years and three valid baseline years. Zero or missing baselines are not converted to infinite percentages.</p>
          <p><strong>Indicator composite:</strong> The composite is the arithmetic mean of valid species-level anomaly percentages with equal weight per species and at least two contributing species. It does not combine raw fish counts across species.</p>
          <p><strong>Interpretation:</strong> These visuals should be read as coastal ecosystem signals and fishery condition indicators. They can reflect ecological conditions, fishing behavior, regulations, access, and survey coverage; they do not prove a specific environmental cause or definitive population change.</p>
          <p><strong>Release rate:</strong> released / (kept + released), null when counts are incomplete or the denominator is zero.</p>
          <p><strong>Quality handling:</strong> QA/QC flag counts are surfaced. The source metadata says full QA/QC methodology is forthcoming.</p>
          <p><strong>Geography:</strong> ${data.metadata.geography.source_format}, ${data.metadata.geography.source_crs}, converted to ${data.metadata.geography.browser_crs}. Numeric historic area codes do not have separate polygons.</p>
          <p><strong>License:</strong> Source package is public domain / CC0 per NPS metadata. Basemap © OpenStreetMap contributors.</p>
          <p>This is an independent visualization and does not imply National Park Service endorsement.</p>
          <p><a href="${data.metadata.source_page}" target="_blank" rel="noreferrer">NPS IRMA source</a> · <a href="${data.metadata.catalog_page}" target="_blank" rel="noreferrer">Data.gov catalog</a> · <a href="https://github.com/aaron-ski/everglades-fisheries-dashboard" target="_blank" rel="noreferrer">GitHub repository</a></p>
        </div>
      </details>
    </main>
  `;

  fisheriesMap = new FisheriesMap(document.querySelector("#map") as HTMLElement, data.areasGeojson, (areaCode, additive) => {
    state.areaMode = "detailed";
    state.selectedAreas = nextSelectedAreas(areaCode, additive);
    syncControls();
    update();
  });
  ecosystemAnomalyMap = new EcosystemAnomalyMap(document.querySelector("#ecosystemAnomalyMap") as HTMLElement, data.areasGeojson, (areaCode, additive) => {
    state.areaMode = "detailed";
    state.selectedAreas = nextSelectedAreas(areaCode, additive);
    syncControls();
    update();
  });
}

function bindControls(): void {
  const speciesPicker = document.querySelector<HTMLElement>("#speciesPicker")!;
  const speciesInput = document.querySelector<HTMLInputElement>("#speciesSearchInput")!;
  const speciesDropdown = document.querySelector<HTMLElement>("#speciesDropdown")!;
  speciesInput.addEventListener("focus", () => openSpeciesDropdown());
  speciesInput.addEventListener("input", () => {
    openSpeciesDropdown();
    renderSpeciesDropdown(speciesInput.value);
  });
  speciesDropdown.addEventListener("change", (event) => {
    const input = event.target as HTMLInputElement;
    if (input.name !== "speciesFilter") return;
    if (input.value === "all") {
      state.selectedSpeciesIds = [];
    } else {
      const selected = new Set(state.selectedSpeciesIds);
      if (input.checked) {
        selected.add(input.value);
      } else {
        selected.delete(input.value);
      }
      state.selectedSpeciesIds = [...selected];
    }
    speciesInput.value = "";
    renderSpeciesDropdown("");
    update();
  });
  document.addEventListener("click", (event) => {
    if (!speciesPicker.contains(event.target as Node)) closeSpeciesDropdown();
  });
  document.querySelector<HTMLSelectElement>("#metricSelect")!.addEventListener("change", (event) => {
    state.metric = (event.target as HTMLSelectElement).value as MetricKey;
    update();
  });
  document.querySelector<HTMLSelectElement>("#areaModeSelect")!.addEventListener("change", (event) => {
    state.areaMode = (event.target as HTMLSelectElement).value as DashboardState["areaMode"];
    update();
  });
  document.querySelectorAll<HTMLInputElement>('input[name="regionFilter"]').forEach((input) => {
    input.addEventListener("change", () => {
      state.selectedRegions = checkedValues("regionFilter");
      update();
    });
  });
  document.querySelectorAll<HTMLInputElement>('input[name="areaFilter"]').forEach((input) => {
    input.addEventListener("change", () => {
      state.selectedAreas = checkedValues("areaFilter");
      update();
    });
  });
  document.querySelector<HTMLInputElement>("#startYearRange")!.addEventListener("input", (event) => {
    state.startYear = Number((event.target as HTMLInputElement).value);
    if (state.startYear > state.endYear) state.endYear = state.startYear;
    update();
  });
  document.querySelector<HTMLInputElement>("#endYearRange")!.addEventListener("input", (event) => {
    state.endYear = Number((event.target as HTMLInputElement).value);
    if (state.endYear < state.startYear) state.startYear = state.endYear;
    update();
  });
  document.querySelector<HTMLButtonElement>("#resetButton")!.addEventListener("click", () => {
    state = defaultState(data.metadata);
    ecosystemIndicator = INDICATOR_COMPOSITE_ID;
    selectedHeatmapCellKey = null;
    update();
  });
  document.querySelector<HTMLButtonElement>("#showAllAreasButton")!.addEventListener("click", () => {
    state.areaMode = "detailed";
    state.selectedAreas = [];
    update();
  });
  document.querySelector<HTMLSelectElement>("#ecosystemIndicatorSelect")!.addEventListener("change", (event) => {
    ecosystemIndicator = (event.target as HTMLSelectElement).value as EcosystemIndicatorId;
    update();
  });
  document.querySelector<HTMLButtonElement>("#showAllEcosystemAreasButton")!.addEventListener("click", () => {
    state.areaMode = "detailed";
    state.selectedAreas = [];
    update();
  });
}

function syncControls(): void {
  syncSpeciesControl();
  document.querySelector<HTMLSelectElement>("#metricSelect")!.value = state.metric;
  document.querySelector<HTMLSelectElement>("#areaModeSelect")!.value = state.areaMode;
  document.querySelectorAll<HTMLInputElement>('input[name="regionFilter"]').forEach((input) => {
    input.checked = state.selectedRegions.includes(input.value);
  });
  document.querySelectorAll<HTMLInputElement>('input[name="areaFilter"]').forEach((input) => {
    input.checked = state.selectedAreas.includes(input.value);
  });
  document.querySelector<HTMLInputElement>("#startYearRange")!.value = String(state.startYear);
  document.querySelector<HTMLInputElement>("#endYearRange")!.value = String(state.endYear);
  document.querySelector("#yearRangeLabel")!.textContent = `${state.startYear}-${state.endYear}`;
  document.querySelector<HTMLSelectElement>("#ecosystemIndicatorSelect")!.value = ecosystemIndicator;
  const regionWrap = document.querySelector<HTMLElement>("#regionFilterWrap")!;
  regionWrap.hidden = state.areaMode !== "regions";
  document.querySelector<HTMLElement>("#detailedAreaWrap")!.hidden = state.areaMode !== "detailed";
}

function openSpeciesDropdown(): void {
  const dropdown = document.querySelector<HTMLElement>("#speciesDropdown")!;
  dropdown.hidden = false;
  document.querySelector<HTMLInputElement>("#speciesSearchInput")!.setAttribute("aria-expanded", "true");
}

function closeSpeciesDropdown(): void {
  const dropdown = document.querySelector<HTMLElement>("#speciesDropdown")!;
  dropdown.hidden = true;
  document.querySelector<HTMLInputElement>("#speciesSearchInput")!.setAttribute("aria-expanded", "false");
}

function syncSpeciesControl(): void {
  const input = document.querySelector<HTMLInputElement>("#speciesSearchInput")!;
  const dropdown = document.querySelector<HTMLElement>("#speciesDropdown")!;
  const summary = document.querySelector<HTMLElement>("#speciesSummary")!;
  input.placeholder = speciesSelectionLabel();
  if (document.activeElement !== input) input.value = "";
  input.setAttribute("aria-expanded", dropdown.hidden ? "false" : "true");
  summary.textContent = speciesSelectionLabel();
  renderSpeciesDropdown(input.value);
}

function renderSpeciesDropdown(filter: string): void {
  const dropdown = document.querySelector<HTMLElement>("#speciesDropdown");
  if (!dropdown) return;
  const selectedSpecies = new Set(state.selectedSpeciesIds);
  const query = filter.trim().toLowerCase();
  const speciesOptions = data.species.filter((item) => {
    const searchable = `${item.display_name} ${item.scientific_name} ${item.original_name}`.toLowerCase();
    return searchable.includes(query);
  });
  dropdown.innerHTML = `
    <label class="check-option species-option species-option-all">
      <input type="checkbox" name="speciesFilter" value="all" ${selectedSpecies.size === 0 ? "checked" : ""} />
      <span>All</span>
    </label>
    ${
      speciesOptions.length
        ? speciesOptions
            .map(
              (item) => `
                <label class="check-option species-option">
                  <input type="checkbox" name="speciesFilter" value="${escapeHtml(item.species_id)}" ${selectedSpecies.has(item.species_id) ? "checked" : ""} />
                  <span>${escapeHtml(item.display_name)}<small>${escapeHtml(item.scientific_name)}</small></span>
                </label>
              `
            )
            .join("")
        : '<p class="species-empty">No species match that search.</p>'
    }
  `;
}

function speciesSelectionLabel(): string {
  if (state.selectedSpeciesIds.length === 0) return "All species";
  if (state.selectedSpeciesIds.length === 1) {
    const selected = data.species.find((item) => item.species_id === state.selectedSpeciesIds[0]);
    return selected?.display_name ?? "1 species selected";
  }
  return `${state.selectedSpeciesIds.length} species selected`;
}

function update(): void {
  syncControls();
  history.replaceState(null, "", `${location.pathname}?${toQuery(state)}`);
  const allRecords = recordsForState(data, state);
  const records = selectedPeriod(allRecords, state.startYear, state.endYear);
  renderWarnings(records);
  renderCards(records);
  renderTrendChart(document.querySelector("#trendChart") as HTMLElement, records, state.metric);
  renderEffortChart(document.querySelector("#effortChart") as HTMLElement, records);
  renderKeptReleasedChart(document.querySelector("#keptChart") as HTMLElement, records);
  document.querySelector("#trendSummary")!.textContent = summarizeChart(records, state.metric);
  renderMap();
  renderEcosystemSignals();
  fisheriesMap?.invalidate();
  ecosystemAnomalyMap?.invalidate();
}

function renderEcosystemSignals(): void {
  const scope = ecosystemScope();
  const heatmapCells = buildHeatmapCells(data, scope, state.startYear, state.endYear);
  const anomaly = buildAnomalyAreas(data, scope, state.startYear, state.endYear, ecosystemIndicator);
  const recentWindow = latestFiveCompleteYears(data.coverage.years, state.startYear, state.endYear);
  const partialNote = document.querySelector<HTMLElement>("#ecosystemPartialNote")!;
  partialNote.hidden = !recentWindow.excludedPartialEndYear;
  partialNote.textContent = recentWindow.excludedPartialEndYear ? `Partial ${state.endYear} is selectable in the dashboard but is excluded from recent five-year ecosystem calculations; the latest complete comparison year is ${recentWindow.recentEnd}.` : "";
  document.querySelector("#heatmapSubtitle")!.textContent = `Annual CPUE relative to each species' distribution during ${state.startYear}-${state.endYear}`;
  document.querySelector("#anomalySubtitle")!.textContent = `Five-year CPUE anomaly: ${anomaly.window.recentStart}-${anomaly.window.recentEnd} compared with the ${anomaly.window.baselineStart}-${anomaly.window.baselineEnd} baseline`;
  renderHeatmap(heatmapCells);
  renderAnomalyMap(anomaly.areas, anomaly.window, anomaly.emptyReason);
}

function ecosystemScope(): EcosystemScope {
  return {
    areaMode: state.areaMode,
    selectedRegions: state.selectedRegions,
    selectedAreas: state.selectedAreas,
    mappedAreaCodes: mappedAreaCodesFromGeojson(data.areasGeojson)
  };
}

function renderHeatmap(cells: HeatmapCell[]): void {
  const selectedCell = selectedHeatmapCellKey ? cells.find((cell) => heatmapCellKey(cell.species.id, cell.year) === selectedHeatmapCellKey) : null;
  if (selectedHeatmapCellKey && !selectedCell) selectedHeatmapCellKey = null;
  renderEcosystemHeatmap(document.querySelector("#ecosystemHeatmap") as HTMLElement, cells, state.startYear, state.endYear, selectedHeatmapCellKey, (key) => {
    selectedHeatmapCellKey = key;
    renderEcosystemSignals();
  });
  document.querySelector("#heatmapLegend")!.innerHTML = [
    ["Limited or missing data", "#334155", "striped"],
    ["Below 10th", "#b91c1c", ""],
    ["10th-25th", "#f97316", ""],
    ["25th-50th", "#facc15", ""],
    ["50th-75th", "#bef264", ""],
    ["75th-90th", "#4ade80", ""],
    ["Above 90th", "#15803d", ""]
  ]
    .map(([label, color, extra]) => `<span><i class="${extra}" style="background:${color}"></i>${label}</span>`)
    .join("");
  const activeCell = selectedHeatmapCellKey ? cells.find((cell) => heatmapCellKey(cell.species.id, cell.year) === selectedHeatmapCellKey) : null;
  document.querySelector("#heatmapDetail")!.innerHTML = activeCell
    ? `<strong>${escapeHtml(activeCell.species.commonName)} in ${activeCell.year}</strong>: ${formatCpue(activeCell.cpue)} fish per angler-hour; ${activeCell.percentile === null ? "limited percentile" : `${activeCell.percentile.toFixed(1)}th percentile`}; ${escapeHtml(activeCell.band)}. Catch ${activeCell.catch.toLocaleString()}, effort ${formatEffort(activeCell.effort)}, trips ${activeCell.surveyedTrips.toLocaleString()}, coverage ${escapeHtml(activeCell.coverageStatus)}.`
    : "Select a heatmap cell to see its CPUE, percentile band, catch, effort, trips, and coverage details.";
}

function renderAnomalyMap(areas: AnomalyArea[], window: BaselineWindow, emptyReason: string | null): void {
  const empty = document.querySelector<HTMLElement>("#anomalyEmptyState")!;
  empty.hidden = emptyReason === null;
  empty.textContent = emptyReason ?? "";
  const mapElement = document.querySelector<HTMLElement>("#ecosystemAnomalyMap")!;
  mapElement.hidden = emptyReason !== null;
  ecosystemAnomalyMap?.update(areas, ecosystemIndicator, window, state.selectedAreas);
  renderAnomalyLegend();
  renderAnomalyTable(areas, emptyReason);
}

function renderAnomalyLegend(): void {
  const categories = [
    "Greater than +50%",
    "+25% to +50%",
    "+10% to +25%",
    "-10% to +10%",
    "-25% to -10%",
    "-50% to -25%",
    "Less than -50%",
    "Limited data"
  ];
  document.querySelector("#anomalyLegend")!.innerHTML = categories
    .map((category) => `<span><span class="legend-swatch ${category === "Limited data" ? "striped" : ""}" style="background:${colorForAnomaly(category)}"></span>${category}</span>`)
    .join("");
}

function renderAnomalyTable(areas: AnomalyArea[], emptyReason: string | null): void {
  if (emptyReason) {
    document.querySelector("#anomalyTable")!.innerHTML = "";
    return;
  }
  const rows = areas
    .filter((area) => area.isActive)
    .sort((a, b) => {
      if (a.anomalyPercent === null && b.anomalyPercent === null) return a.areaCode.localeCompare(b.areaCode);
      if (a.anomalyPercent === null) return 1;
      if (b.anomalyPercent === null) return -1;
      return Math.abs(b.anomalyPercent) - Math.abs(a.anomalyPercent);
    })
    .map(
      (area) => `<tr>
        <td>${escapeHtml(area.areaCode)} - ${escapeHtml(area.areaName)}</td>
        <td>${escapeHtml(area.broadRegion)}</td>
        <td>${formatCpue(area.recentCpue)}</td>
        <td>${formatCpue(area.baselineCpue)}</td>
        <td>${formatPercent(area.anomalyPercent)}</td>
        <td>${escapeHtml(area.category)}</td>
        <td>${area.validContributingSpecies}</td>
        <td>${escapeHtml(area.confidence)}${area.coverageWarnings.length ? `; ${escapeHtml(area.coverageWarnings.join("; "))}` : ""}</td>
      </tr>`
    )
    .join("");
  document.querySelector("#anomalyTable")!.innerHTML = `
    <details class="table-disclosure">
      <summary>Show anomaly values table</summary>
      <table>
        <caption>Anomaly values by fishing area for ${escapeHtml(indicatorLabel(ecosystemIndicator))}</caption>
        <thead><tr><th>Area</th><th>Broad region</th><th>Recent CPUE</th><th>Baseline CPUE</th><th>Anomaly</th><th>Category</th><th>Valid species</th><th>Coverage/confidence</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="8">No mapped areas match the active selection.</td></tr>'}</tbody>
      </table>
    </details>
  `;
}

function formatCpue(value: number | null): string {
  return value === null ? "No data" : value.toFixed(3);
}

function formatEffort(value: number | null): string {
  return value === null ? "No data" : value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function formatPercent(value: number | null): string {
  return value === null ? "Limited data" : `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function renderWarnings(records: DisplayRecord[]): void {
  const warnings = new Set<string>();
  if (records.length === 0) {
    warnings.add("No data for the active area selection. Select at least one region or area.");
  }
  if (state.endYear === 2025 || records.some((record) => record.isPartialYear)) {
    warnings.add("2025 is a partial year in the source package and should not be compared directly with full-year totals.");
  }
  for (const record of records) {
    if (record.coverageStatus === "interrupted survey coverage") {
      warnings.add(`${record.year} has interrupted survey coverage (${record.monthsPresent} months present).`);
    }
    if (record.effort === null && state.metric === "cpue") {
      warnings.add("Some records have no effort denominator, so catch rate is not shown for them.");
    }
  }
  document.querySelector("#warnings")!.innerHTML = [...warnings].map((warning) => `<p>${warning}</p>`).join("");
}

function renderCards(records: DisplayRecord[]): void {
  const latestYear = latestCompleteYear(data, state.endYear);
  const latest = records.filter((record) => record.year === latestYear);
  const totalCatch = records.reduce((sum, record) => sum + record.catch, 0);
  const totalEffort = records.reduce((sum, record) => sum + (record.effort ?? 0), 0);
  const kept = records.reduce((sum, record) => sum + record.kept, 0);
  const released = records.reduce((sum, record) => sum + record.released, 0);
  const latestMetric = latest.reduce((sum, record) => sum + (record.value ?? 0), 0);
  const firstYear = records.filter((record) => record.year === state.startYear).reduce((sum, record) => sum + (record.value ?? 0), 0);
  const change = percentChange(firstYear, latestMetric);
  const releaseRate = kept + released > 0 ? released / (kept + released) : null;
  const trips = records.reduce((sum, record) => sum + record.surveyedTrips, 0);
  const cards = [
    { label: `Latest complete-year ${metricLabels[state.metric].toLowerCase()}`, value: formatValue(latestMetric, state.metric, true), unit: metricUnits[state.metric], context: `${latestYear}; ${change.text} since ${state.startYear}` },
    { label: "Total reported catch", value: formatValue(totalCatch, "catch", true), unit: "fish", context: `${state.startYear}-${state.endYear}` },
    { label: "Fishing effort", value: formatValue(totalEffort, "effort", true), unit: "angler-hours", context: "Deduplicated surveyed trips" },
    { label: releaseRate === null ? "Surveyed trips" : "Release rate", value: releaseRate === null ? trips.toLocaleString() : formatValue(releaseRate, "release_rate"), unit: releaseRate === null ? "trips" : "%", context: releaseRate === null ? "Coverage count" : "Released / kept plus released" }
  ];
  document.querySelector("#cards")!.innerHTML = cards
    .map((card) => `<article class="card"><span>${card.label}</span><strong>${card.value}</strong><small>${card.unit}</small><p>${card.context}</p></article>`)
    .join("");
}

function renderMap(): void {
  const latestYear = latestCompleteYear(data, state.endYear);
  const mapRecords = mapRecordsForLatestYear(latestYear);
  fisheriesMap?.update(mapRecords, state.metric, state.selectedAreas);
  const rows = mapRecords
    .sort((a, b) => a.label.localeCompare(b.label))
    .map(
      (record) => `<tr><td>${escapeHtml(record.label)}</td><td>${formatValue(record.value, state.metric)} ${metricUnits[state.metric]}</td><td>${record.catch.toLocaleString()}</td><td>${record.effort?.toLocaleString(undefined, { maximumFractionDigits: 1 }) ?? "No data"}</td><td>${escapeHtml(record.coverageStatus)}</td></tr>`
    )
    .join("");
  document.querySelector("#mapTable")!.innerHTML = `
    <details class="table-disclosure">
      <summary>Show mapped area values table</summary>
      <table>
        <caption>Mapped area values for ${latestYear}</caption>
        <thead><tr><th>Area</th><th>${metricLabels[state.metric]}</th><th>Catch</th><th>Effort</th><th>Coverage</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="5">No mapped areas match the active selection.</td></tr>'}</tbody>
      </table>
    </details>
  `;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function checkedValues(name: string): string[] {
  return [...document.querySelectorAll<HTMLInputElement>(`input[name="${name}"]:checked`)].map((input) => input.value);
}

function nextSelectedAreas(areaCode: string, additive: boolean): string[] {
  if (!additive) return [areaCode];
  const selected = new Set(state.selectedAreas);
  if (selected.has(areaCode)) {
    selected.delete(areaCode);
  } else {
    selected.add(areaCode);
  }
  return [...selected];
}

function mapRecordsForLatestYear(latestYear: number): DisplayRecord[] {
  const mapState: DashboardState = {
    ...state,
    areaMode: "detailed",
    selectedAreas: state.areaMode === "detailed" ? state.selectedAreas : []
  };
  return recordsForState(data, mapState)
    .filter((record) => record.year === latestYear && record.areaCode)
    .filter((record) => state.areaMode === "detailed" || state.selectedRegions.length === 0 || state.selectedRegions.includes(record.broadRegion));
}
