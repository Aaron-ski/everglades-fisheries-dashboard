import "leaflet/dist/leaflet.css";
import "./styles/main.css";
import { renderEffortChart, renderKeptReleasedChart, renderTrendChart, summarizeChart } from "./charts";
import { detailedAreaOptions, latestCompleteYear, loadDashboardData, recordsForState } from "./data";
import { renderEcosystemHeatmap, heatmapCellKey } from "./ecosystemCharts";
import { EcosystemAnomalyMap, colorForAnomaly, indicatorLabel } from "./ecosystemMap";
import { buildAnomalyAreas, buildAnomalyWindowFromRanges, buildHeatmapCells, latestFiveCompleteYears, mappedAreaCodesFromGeojson } from "./ecosystemSignals";
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
import type { DashboardData, DashboardState, DataQualityStatus, DataQualitySummary, DisplayRecord, MetricKey } from "./types";

const appElement = document.querySelector<HTMLDivElement>("#app");
if (!appElement) throw new Error("Missing #app");
const app = appElement;

let data: DashboardData;
let state: DashboardState;
let fisheriesMap: FisheriesMap | null = null;
let ecosystemAnomalyMap: EcosystemAnomalyMap | null = null;
let ecosystemIndicator: EcosystemIndicatorId = INDICATOR_COMPOSITE_ID;
let selectedHeatmapCellKey: string | null = null;
let anomalyRanges: AnomalyRanges;
let activeTab: ActiveTab = "dashboard";

type ActiveTab = "dashboard" | "data-quality";

interface AnomalyRanges {
  baselineStart: number;
  baselineEnd: number;
  recentStart: number;
  recentEnd: number;
}

void init();

async function init(): Promise<void> {
  app.innerHTML = '<main class="loading">Loading Everglades fisheries data...</main>';
  try {
    data = await loadDashboardData();
    state = stateFromUrl(data.metadata, window.location.search);
    activeTab = tabFromUrl(window.location.search);
    anomalyRanges = defaultAnomalyRanges();
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
        </div>
      </div>
      <div class="header-meta">
        <span>Last processed ${processed}</span>
        <a href="${data.metadata.source_page}" target="_blank" rel="noreferrer">Official source</a>
      </div>
    </header>
    <nav class="tab-nav" aria-label="Dashboard sections">
      <button class="tab-button" type="button" data-tab="dashboard">Dashboard</button>
      <button class="tab-button" type="button" data-tab="data-quality">Data Quality</button>
    </nav>
    <main id="main">
      <details class="filters-panel dashboard-only">
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
      <section id="warnings" class="warnings dashboard-only" aria-live="polite"></section>
      <section class="panel map-panel dashboard-only">
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
      <section class="panel ecosystem-section dashboard-only" aria-labelledby="ecosystemTitle">
        <div class="section-heading">
          <div>
            <div class="title-with-tooltip">
              <h2 id="ecosystemTitle">Coastal Ecosystem Signals</h2>
              <span class="info-tooltip" tabindex="0" aria-label="CPUE definition and interpretation">
                <span aria-hidden="true">i</span>
                <span class="tooltip-bubble" role="tooltip">CPUE means catch per unit effort: fish caught divided by angler-hours. It standardizes catch by fishing effort, so it can show whether anglers are catching more or fewer fish for the same amount of fishing time. Here it is a fishery-condition signal, not a direct population count or complete ecosystem-health score.</span>
              </span>
            </div>
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
          <div class="comparison-controls" aria-label="Anomaly comparison period controls">
            <div class="timeline-filter comparison-range">
              <div class="timeline-heading">
                <span>Baseline period</span>
                <strong id="baselineRangeLabel"></strong>
              </div>
              <div class="timeline-track">
                <input id="baselineStartRange" aria-label="Baseline start year" type="range" min="${minYear}" max="${maxYear}" step="1" />
                <input id="baselineEndRange" aria-label="Baseline end year" type="range" min="${minYear}" max="${maxYear}" step="1" />
              </div>
              <div class="timeline-scale" aria-hidden="true">
                ${[1980, 1990, 2000, 2010, 2020, 2025].filter((year) => year >= minYear && year <= maxYear).map((year) => `<span>${year}</span>`).join("")}
              </div>
            </div>
            <div class="timeline-filter comparison-range">
              <div class="timeline-heading">
                <span>Comparison period</span>
                <strong id="recentRangeLabel"></strong>
              </div>
              <div class="timeline-track">
                <input id="recentStartRange" aria-label="Comparison start year" type="range" min="${minYear}" max="${maxYear}" step="1" />
                <input id="recentEndRange" aria-label="Comparison end year" type="range" min="${minYear}" max="${maxYear}" step="1" />
              </div>
              <div class="timeline-scale" aria-hidden="true">
                ${[1980, 1990, 2000, 2010, 2020, 2025].filter((year) => year >= minYear && year <= maxYear).map((year) => `<span>${year}</span>`).join("")}
              </div>
            </div>
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
      <section id="cards" class="cards dashboard-only" aria-label="Key metrics"></section>
      <section class="split dashboard-only">
        <div class="panel">
          <div class="section-heading compact-heading">
            <h2>Fishing effort</h2>
            <button class="secondary-button chart-expand-button" type="button" data-chart-expand="effort">Expand chart</button>
          </div>
          <p>Effort uses angler-hours from surveyed trips. Trailer counts are separate and are not part of CPUE.</p>
          <div id="effortChart" class="chart compact-chart" role="img" aria-label="Fishing effort chart"></div>
        </div>
        <div class="panel">
          <h2>Kept versus released</h2>
          <p>Harvested and released counts are shown only where the source disposition field supports them.</p>
          <div id="keptChart" class="chart compact-chart" role="img" aria-label="Kept and released chart"></div>
        </div>
      </section>
      <section class="panel dashboard-only">
        <div class="section-heading">
          <h2>Annual trend</h2>
          <div class="chart-heading-actions">
            <p id="trendSummary"></p>
            <button class="secondary-button chart-expand-button" type="button" data-chart-expand="trend">Expand chart</button>
          </div>
        </div>
        <div id="trendChart" class="chart" role="img" aria-label="Annual trend chart"></div>
      </section>
      <details class="help dashboard-only">
        <summary>How to use this dashboard</summary>
        <p>Pick one or more species, metric, area view, and year range. The charts, maps, cards, and ecosystem signals update together. Use Reset to return to ${data.metadata.date_coverage.default_start_year}-${data.metadata.date_coverage.default_end_year}, catch rate, all species, and all broad regions.</p>
      </details>
      <details class="methodology dashboard-only">
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
      <section id="dataQualityView" class="data-quality-view" aria-labelledby="dataQualityTitle">
        ${renderDataQualityPanel(data.dataQuality)}
      </section>
      <div id="chartModal" class="chart-modal" hidden>
        <div class="chart-modal__backdrop" data-modal-close></div>
        <section class="chart-modal__panel" role="dialog" aria-modal="true" aria-labelledby="chartModalTitle">
          <div class="section-heading">
            <h2 id="chartModalTitle"></h2>
            <button class="secondary-button" id="chartModalClose" type="button">Close</button>
          </div>
          <div id="expandedChart" class="chart expanded-chart" role="img"></div>
        </section>
      </div>
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
  document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      activeTab = button.dataset.tab === "data-quality" ? "data-quality" : "dashboard";
      update();
    });
  });
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
    anomalyRanges = defaultAnomalyRanges();
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
  document.querySelector<HTMLInputElement>("#baselineStartRange")!.addEventListener("input", (event) => {
    anomalyRanges.baselineStart = Number((event.target as HTMLInputElement).value);
    normalizeAnomalyRanges("baselineStart");
    update();
  });
  document.querySelector<HTMLInputElement>("#baselineEndRange")!.addEventListener("input", (event) => {
    anomalyRanges.baselineEnd = Number((event.target as HTMLInputElement).value);
    normalizeAnomalyRanges("baselineEnd");
    update();
  });
  document.querySelector<HTMLInputElement>("#recentStartRange")!.addEventListener("input", (event) => {
    anomalyRanges.recentStart = Number((event.target as HTMLInputElement).value);
    normalizeAnomalyRanges("recentStart");
    update();
  });
  document.querySelector<HTMLInputElement>("#recentEndRange")!.addEventListener("input", (event) => {
    anomalyRanges.recentEnd = Number((event.target as HTMLInputElement).value);
    normalizeAnomalyRanges("recentEnd");
    update();
  });
  document.querySelectorAll<HTMLButtonElement>("[data-chart-expand]").forEach((button) => {
    button.addEventListener("click", () => openChartModal(button.dataset.chartExpand === "effort" ? "effort" : "trend"));
  });
  document.querySelector<HTMLButtonElement>("#chartModalClose")!.addEventListener("click", closeChartModal);
  document.querySelector<HTMLElement>("[data-modal-close]")!.addEventListener("click", closeChartModal);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !document.querySelector<HTMLElement>("#chartModal")!.hidden) closeChartModal();
  });
}

function syncControls(): void {
  syncTabControls();
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
  document.querySelector<HTMLInputElement>("#baselineStartRange")!.value = String(anomalyRanges.baselineStart);
  document.querySelector<HTMLInputElement>("#baselineEndRange")!.value = String(anomalyRanges.baselineEnd);
  document.querySelector<HTMLInputElement>("#recentStartRange")!.value = String(anomalyRanges.recentStart);
  document.querySelector<HTMLInputElement>("#recentEndRange")!.value = String(anomalyRanges.recentEnd);
  document.querySelector("#baselineRangeLabel")!.textContent = `${anomalyRanges.baselineStart}-${anomalyRanges.baselineEnd}`;
  document.querySelector("#recentRangeLabel")!.textContent = `${anomalyRanges.recentStart}-${anomalyRanges.recentEnd}`;
  document.querySelector<HTMLSelectElement>("#ecosystemIndicatorSelect")!.value = ecosystemIndicator;
  const regionWrap = document.querySelector<HTMLElement>("#regionFilterWrap")!;
  regionWrap.hidden = state.areaMode !== "regions";
  document.querySelector<HTMLElement>("#detailedAreaWrap")!.hidden = state.areaMode !== "detailed";
}

function syncTabControls(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((button) => {
    const selected = button.dataset.tab === activeTab;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-current", selected ? "page" : "false");
  });
  document.querySelectorAll<HTMLElement>(".dashboard-only").forEach((element) => {
    element.hidden = activeTab !== "dashboard";
  });
  document.querySelector<HTMLElement>("#dataQualityView")!.hidden = activeTab !== "data-quality";
}

function tabFromUrl(search: string): ActiveTab {
  return new URLSearchParams(search).get("tab") === "data-quality" ? "data-quality" : "dashboard";
}

function dashboardQuery(): string {
  const params = new URLSearchParams(toQuery(state));
  if (activeTab === "data-quality") params.set("tab", "data-quality");
  return params.toString();
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

function renderDataQualityPanel(summary: DataQualitySummary | null): string {
  if (!summary) {
    return `
      <section class="panel data-quality-section">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Source & Data Quality</p>
            <h2 id="dataQualityTitle">Data Quality & Source Verification</h2>
          </div>
          ${statusBadge("warning", "Warning")}
        </div>
        <p class="quality-lede">The dashboard data loaded, but the compact data-quality summary file is missing. Run <code>npm run build:data-quality</code> to regenerate <code>public/data/data_quality_summary.json</code>.</p>
      </section>
    `;
  }
  const status = currentDataQualityStatus(summary);
  const official = summary.officialSource ?? {};
  const coverage = summary.dateCoverage ?? {};
  const freshness = summary.freshness ?? {};
  const integrity = summary.sourceIntegrity ?? {};
  const validation = summary.validationSummary ?? {};
  const rows = summary.rowCounts ?? {};
  const cpue = summary.cpueSpotChecks ?? {};
  const files = integrity.files ?? [];
  const checks = cpue.checks ?? [];
  const statusMessages = [...(summary.overallStatus?.errors ?? []), ...(summary.overallStatus?.warnings ?? [])];
  return `
    <section class="panel data-quality-section">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Source & Data Quality</p>
          <h2 id="dataQualityTitle">Data Quality & Source Verification</h2>
          <p class="quality-lede">${escapeHtml(summary.overallStatus?.message ?? "Data quality evidence was generated from committed metadata and validation outputs.")}</p>
        </div>
        ${statusBadge(status.status, status.label)}
      </div>
      ${statusMessages.length ? `<div class="quality-alerts">${statusMessages.map((message) => `<p>${escapeHtml(message)}</p>`).join("")}</div>` : ""}
      <div class="quality-card-grid">
        ${dataQualityCard("Overall Data Status", `
          <p>${escapeHtml(status.explanation)}</p>
          <dl class="quality-facts">
            <div><dt>Coverage</dt><dd>${formatYearRange(coverage.minYear, coverage.maxYear)}</dd></div>
            <div><dt>Last processed</dt><dd>${formatDateTime(freshness.processedAt)}</dd></div>
            <div><dt>Needs resync</dt><dd>${freshness.needsResync || status.status !== "healthy" ? "Review recommended" : "No"}</dd></div>
          </dl>
        `)}
        ${dataQualityCard("Official Source", `
          <p>${escapeHtml(official.explanation ?? "Dashboard data is derived from the official NPS/Data.gov source package.")}</p>
          <dl class="quality-facts">
            <div><dt>Source title</dt><dd>${escapeHtml(official.title ?? "NPS/Data.gov source package")}</dd></div>
            <div><dt>Retrieved</dt><dd>${formatDateTime(official.retrievedAt)}</dd></div>
            <div><dt>Files recorded</dt><dd>${formatInteger(official.sourceFileCount)}</dd></div>
          </dl>
          <p class="quality-links">${qualityLink(official.sourcePage, "NPS IRMA source")} ${qualityLink(official.catalogPage, "Data.gov catalog")}</p>
        `)}
        ${dataQualityCard("Date Coverage", `
          <dl class="quality-facts">
            <div><dt>Minimum event date</dt><dd>${formatPlainDate(coverage.minEventDate)}</dd></div>
            <div><dt>Maximum event date</dt><dd>${formatPlainDate(coverage.maxEventDate)}</dd></div>
            <div><dt>Available years</dt><dd>${formatYearRange(coverage.minYear, coverage.maxYear)} (${formatInteger(coverage.yearCount)} years)</dd></div>
            <div><dt>Every year present</dt><dd>${coverage.everyYearPresent ? "Yes" : `Missing ${coverage.missingYears?.join(", ") || "unknown years"}`}</dd></div>
          </dl>
          <p>${escapeHtml(coverage.note ?? "Some species or area combinations may still be sparse in individual years.")}</p>
          <p class="quality-muted">Partial years: ${formatYearList(coverage.partialYears)}. Interrupted coverage: ${formatYearList(coverage.interruptedYears)}.</p>
        `)}
        ${dataQualityCard("Freshness / Last Updated", `
          <dl class="quality-facts">
            <div><dt>Processed</dt><dd>${formatDateTime(freshness.processedAt)}${relativeAgeText(freshness.processedAt)}</dd></div>
            <div><dt>Source retrieved</dt><dd>${formatDateTime(freshness.sourceLastRetrievedAt)}${relativeAgeText(freshness.sourceLastRetrievedAt)}</dd></div>
            <div><dt>Freshness rule</dt><dd>Warning after ${summary.freshnessThresholdDays?.warning ?? 45} days; stale after ${summary.freshnessThresholdDays?.stale ?? 120} days.</dd></div>
          </dl>
          <p>${escapeHtml(freshness.explanation ?? "Freshness is computed from metadata timestamps at runtime.")}</p>
        `)}
        ${dataQualityCard("Source Integrity", `
          <dl class="quality-facts">
            <div><dt>Hashes recorded</dt><dd>${formatInteger(integrity.filesWithHashes)} of ${files.length}</dd></div>
            <div><dt>File sizes recorded</dt><dd>${formatInteger(integrity.filesWithSizes)} of ${files.length}</dd></div>
            <div><dt>Retrieval timestamps</dt><dd>${formatInteger(integrity.filesWithRetrievalTimestamps)} of ${files.length}</dd></div>
          </dl>
          <p>${escapeHtml(integrity.note ?? "Hashes are recorded from the latest source retrieval; this page does not re-download source files.")}</p>
          ${files.length ? `<div class="quality-table-wrap"><table class="quality-table"><thead><tr><th>File</th><th>Size</th><th>SHA-256</th><th>Retrieved</th></tr></thead><tbody>${files
            .map((file) => `<tr><td>${escapeHtml(file.filename ?? file.key ?? "Unknown file")}</td><td>${formatBytes(file.size)}</td><td>${file.sha256Recorded ? `hash recorded (${escapeHtml(file.sha256Short ?? "")})` : "missing"}</td><td>${formatDateTime(file.retrievedAt)}</td></tr>`)
            .join("")}</tbody></table></div>` : ""}
        `)}
        ${dataQualityCard("Validation Summary", `
          <dl class="quality-facts">
            <div><dt>Status</dt><dd>${statusBadge(validation.status ?? "missing", statusText(validation.status ?? "missing"))}</dd></div>
            <div><dt>Total checks</dt><dd>${formatInteger(validation.totalChecks)}</dd></div>
            <div><dt>Passed</dt><dd>${formatInteger(validation.passedChecks)}</dd></div>
            <div><dt>Failed</dt><dd>${formatInteger(validation.failedChecks)}</dd></div>
          </dl>
          <p class="quality-muted">Years checked: ${formatYearRangeFromList(validation.yearsChecked)}. Summary warnings: ${formatInteger(validation.warningCount)}. Summary errors: ${formatInteger(validation.errorCount)}.</p>
        `)}
        ${dataQualityCard("Row Count Reconciliation", `
          <dl class="quality-facts">
            <div><dt>Area annual records</dt><dd>${countPair(rows.processedAnnualAreaRecords)}</dd></div>
            <div><dt>Region annual records</dt><dd>${countPair(rows.processedAnnualRegionRecords)}</dd></div>
            <div><dt>Species</dt><dd>${countPair(rows.speciesCount)}</dd></div>
            <div><dt>QA/QC flags represented</dt><dd>${formatInteger(rows.qualityFlaggedRecords)}</dd></div>
            <div><dt>Catch records represented</dt><dd>${formatInteger(rows.catchRecordsRepresented)}</dd></div>
            <div><dt>Raw records</dt><dd>${rows.rawRecords === null || rows.rawRecords === undefined ? "Not exposed in public build" : formatInteger(rows.rawRecords)}</dd></div>
          </dl>
          <p>${escapeHtml(rows.note ?? "Expected values are reported by the latest build summary.")}</p>
          <p class="quality-muted">${escapeHtml(rows.rawRecordsNote ?? "")}</p>
        `)}
        ${dataQualityCard("CPUE Spot Checks", `
          <p>${escapeHtml(cpue.method ?? "Spot checks recompute CPUE from available processed data.")}</p>
          <p>${statusBadge(cpue.status ?? "missing", statusText(cpue.status ?? "missing"))} Raw interview rows in public build: ${cpue.rawDataAvailableInPublicBuild ? "yes" : "no"}</p>
          ${checks.length ? `<div class="quality-table-wrap"><table class="quality-table"><thead><tr><th>Example</th><th>Catch</th><th>Effort</th><th>Processed</th><th>Recomputed</th><th>Status</th></tr></thead><tbody>${checks
            .map((check) => `<tr><td>${escapeHtml(check.label ?? "Spot check")}</td><td>${formatInteger(check.catch)}</td><td>${formatNumber(check.effortDenominator)}</td><td>${formatCpueCheck(check.processedCpue)}</td><td>${formatCpueCheck(check.recomputedCpue)}</td><td>${statusBadge(check.status ?? "missing", statusText(check.status ?? "missing"))}</td></tr>`)
            .join("")}</tbody></table></div>` : "<p>No CPUE spot checks were included in the summary.</p>"}
        `)}
      </div>
      <section class="panel quality-limitations">
        <h3>Known Limitations</h3>
        <ul>${(summary.limitations ?? []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </section>
    </section>
  `;
}

function dataQualityCard(title: string, body: string): string {
  return `<article class="quality-card"><h3>${escapeHtml(title)}</h3>${body}</article>`;
}

function currentDataQualityStatus(summary: DataQualitySummary): { status: DataQualityStatus; label: string; explanation: string } {
  const processedAt = summary.freshness?.processedAt ?? null;
  const warningDays = summary.freshnessThresholdDays?.warning ?? 45;
  const staleDays = summary.freshnessThresholdDays?.stale ?? 120;
  const processedAge = ageInDays(processedAt);
  const summaryStatus = summary.overallStatus?.status ?? "missing";
  if (summaryStatus === "error" || summaryStatus === "failed") return { status: "error", label: "Error", explanation: "One or more data-quality checks require attention." };
  if (processedAge === null) return { status: "warning", label: "Warning", explanation: "The processed timestamp is missing or invalid, so freshness cannot be confirmed." };
  if (processedAge > staleDays) return { status: "stale", label: "Stale", explanation: `The dashboard data was processed ${processedAge} days ago, which is beyond the stale threshold.` };
  if (summaryStatus === "warning" || processedAge > warningDays) return { status: "warning", label: "Warning", explanation: `The dashboard data is ${processedAge} days old or has non-blocking warnings to review.` };
  return { status: "healthy", label: "Healthy", explanation: `Source verified. Data covers the expected years and was processed ${processedAge} days ago.` };
}

function statusBadge(status: DataQualityStatus | string, label: string): string {
  const normalized = status === "passed" ? "healthy" : status === "failed" ? "error" : status;
  return `<span class="status-badge status-${escapeHtml(String(normalized))}">${escapeHtml(label)}</span>`;
}

function statusText(status: DataQualityStatus | string): string {
  if (status === "passed") return "Passed";
  if (status === "failed") return "Failed";
  if (status === "healthy") return "Healthy";
  if (status === "warning") return "Warning";
  if (status === "stale") return "Stale";
  if (status === "error") return "Error";
  return "Missing";
}

function qualityLink(url: string | null | undefined, label: string): string {
  return url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>` : "";
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return escapeHtml(value);
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatPlainDate(value: string | null | undefined): string {
  return value ? escapeHtml(value) : "Not recorded";
}

function relativeAgeText(value: string | null | undefined): string {
  const age = ageInDays(value);
  return age === null ? "" : ` (${age} days ago)`;
}

function ageInDays(value: string | null | undefined): number | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86_400_000));
}

function formatYearRange(start: number | null | undefined, end: number | null | undefined): string {
  if (start === null || start === undefined || end === null || end === undefined) return "Not recorded";
  return `${start}-${end}`;
}

function formatYearRangeFromList(years: number[] | undefined): string {
  if (!years?.length) return "Not recorded";
  return `${Math.min(...years)}-${Math.max(...years)}`;
}

function formatYearList(years: number[] | undefined): string {
  return years?.length ? years.join(", ") : "none recorded";
}

function formatInteger(value: number | null | undefined): string {
  return value === null || value === undefined ? "Not recorded" : value.toLocaleString();
}

function formatNumber(value: number | null | undefined): string {
  return value === null || value === undefined ? "Not recorded" : value.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

function formatCpueCheck(value: number | null | undefined): string {
  return value === null || value === undefined ? "No data" : value.toFixed(6);
}

function formatBytes(value: number | null | undefined): string {
  if (value === null || value === undefined) return "Not recorded";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} MB`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)} KB`;
  return `${value} B`;
}

function countPair(pair: { expected?: number | null; actual?: number | null } | undefined): string {
  if (!pair) return "Not recorded";
  return `${formatInteger(pair.actual)} actual${pair.expected === null || pair.expected === undefined ? "" : ` / ${formatInteger(pair.expected)} reported by latest build`}`;
}

function defaultAnomalyRanges(): AnomalyRanges {
  const recent = latestFiveCompleteYears(data.coverage.years, state.startYear, state.endYear);
  const minYear = data.metadata.date_coverage.unique_years[0];
  const recentStart = recent.recentStart;
  const baselineEnd = Math.max(minYear, recentStart - 1);
  return {
    baselineStart: Math.min(Math.max(state.startYear, minYear), baselineEnd),
    baselineEnd,
    recentStart,
    recentEnd: recent.recentEnd
  };
}

function normalizeAnomalyRanges(changed: keyof AnomalyRanges): void {
  const years = data.metadata.date_coverage.unique_years;
  const minYear = years[0];
  const maxYear = years.at(-1) ?? data.metadata.date_coverage.default_end_year;
  anomalyRanges = {
    baselineStart: clampYear(anomalyRanges.baselineStart, minYear, maxYear),
    baselineEnd: clampYear(anomalyRanges.baselineEnd, minYear, maxYear),
    recentStart: clampYear(anomalyRanges.recentStart, minYear, maxYear),
    recentEnd: clampYear(anomalyRanges.recentEnd, minYear, maxYear)
  };
  if (anomalyRanges.baselineStart > anomalyRanges.baselineEnd) {
    if (changed === "baselineStart") anomalyRanges.baselineEnd = anomalyRanges.baselineStart;
    else anomalyRanges.baselineStart = anomalyRanges.baselineEnd;
  }
  if (anomalyRanges.recentStart > anomalyRanges.recentEnd) {
    if (changed === "recentStart") anomalyRanges.recentEnd = anomalyRanges.recentStart;
    else anomalyRanges.recentStart = anomalyRanges.recentEnd;
  }
  if (anomalyRanges.baselineEnd >= anomalyRanges.recentStart) {
    if (changed === "baselineStart" || changed === "baselineEnd") {
      anomalyRanges.recentStart = Math.min(maxYear, anomalyRanges.baselineEnd + 1);
      if (anomalyRanges.recentEnd < anomalyRanges.recentStart) anomalyRanges.recentEnd = anomalyRanges.recentStart;
    } else {
      anomalyRanges.baselineEnd = Math.max(minYear, anomalyRanges.recentStart - 1);
      if (anomalyRanges.baselineStart > anomalyRanges.baselineEnd) anomalyRanges.baselineStart = anomalyRanges.baselineEnd;
    }
  }
}

function clampYear(year: number, minYear: number, maxYear: number): number {
  return Math.min(maxYear, Math.max(minYear, year));
}

function openChartModal(chart: "trend" | "effort"): void {
  const modal = document.querySelector<HTMLElement>("#chartModal")!;
  const title = document.querySelector<HTMLElement>("#chartModalTitle")!;
  const previousChartElement = document.querySelector<HTMLElement>("#expandedChart")!;
  const chartElement = previousChartElement.cloneNode(false) as HTMLElement;
  previousChartElement.replaceWith(chartElement);
  const records = selectedPeriod(recordsForState(data, state), state.startYear, state.endYear);
  title.textContent = chart === "trend" ? "Annual trend" : "Fishing effort";
  chartElement.setAttribute("aria-label", chart === "trend" ? "Expanded annual trend chart" : "Expanded fishing effort chart");
  modal.hidden = false;
  document.body.classList.add("modal-open");
  if (chart === "trend") {
    renderTrendChart(chartElement, records, state.metric);
  } else {
    renderEffortChart(chartElement, records);
  }
  document.querySelector<HTMLButtonElement>("#chartModalClose")!.focus();
}

function closeChartModal(): void {
  const modal = document.querySelector<HTMLElement>("#chartModal")!;
  const previousChartElement = document.querySelector<HTMLElement>("#expandedChart")!;
  const chartElement = previousChartElement.cloneNode(false) as HTMLElement;
  previousChartElement.replaceWith(chartElement);
  modal.hidden = true;
  document.body.classList.remove("modal-open");
}

function update(): void {
  syncControls();
  history.replaceState(null, "", `${location.pathname}?${dashboardQuery()}`);
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
  const anomalyWindow = buildAnomalyWindowFromRanges(data.coverage.years, anomalyRanges.baselineStart, anomalyRanges.baselineEnd, anomalyRanges.recentStart, anomalyRanges.recentEnd);
  const anomaly = buildAnomalyAreas(data, scope, state.startYear, state.endYear, ecosystemIndicator, anomalyWindow);
  const partialNote = document.querySelector<HTMLElement>("#ecosystemPartialNote")!;
  partialNote.hidden = !anomaly.window.excludedPartialEndYear;
  partialNote.textContent = anomaly.window.excludedPartialEndYear ? `Partial years in the comparison period are excluded from anomaly calculations; the latest complete comparison year is ${anomaly.window.recentEnd}.` : "";
  document.querySelector("#heatmapSubtitle")!.textContent = `Annual CPUE relative to each species' distribution during ${state.startYear}-${state.endYear}`;
  document.querySelector("#anomalySubtitle")!.textContent = `CPUE anomaly: ${anomaly.window.recentStart}-${anomaly.window.recentEnd} compared with the ${anomaly.window.baselineStart}-${anomaly.window.baselineEnd} baseline`;
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
