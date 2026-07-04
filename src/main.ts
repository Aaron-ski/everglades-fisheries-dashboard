import "leaflet/dist/leaflet.css";
import "./styles/main.css";
import { renderEffortChart, renderKeptReleasedChart, renderTrendChart, summarizeChart } from "./charts";
import { detailedAreaOptions, latestCompleteYear, loadDashboardData, recordsForState } from "./data";
import { FisheriesMap } from "./mapView";
import { formatValue, metricLabels, metricUnits, percentChange, selectedPeriod } from "./metrics";
import { defaultState, stateFromUrl, toQuery } from "./state";
import { buildTakeaways } from "./takeaways";
import type { DashboardData, DashboardState, DisplayRecord, MetricKey } from "./types";

const appElement = document.querySelector<HTMLDivElement>("#app");
if (!appElement) throw new Error("Missing #app");
const app = appElement;

let data: DashboardData;
let state: DashboardState;
let fisheriesMap: FisheriesMap | null = null;

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
      <div>
        <p class="eyebrow">National Park Service public data</p>
        <h1>Everglades Fisheries Explorer</h1>
        <p class="subtitle">Twenty years of recreational fishing trends in Everglades National Park</p>
      </div>
      <div class="header-meta">
        <span>Last processed ${processed}</span>
        <a href="${data.metadata.source_page}" target="_blank" rel="noreferrer">Official source</a>
      </div>
    </header>
    <main id="main">
      <details class="help">
        <summary>How to use this dashboard</summary>
        <p>Pick one or more species, metric, area view, and year range. The charts, map, cards, and takeaways update together. Use Reset to return to ${data.metadata.date_coverage.default_start_year}-${data.metadata.date_coverage.default_end_year}, catch rate, all species, and all broad regions.</p>
      </details>
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
      <section class="panel takeaways">
        <h2>Quick takeaways</h2>
        <ul id="takeaways"></ul>
        <details>
          <summary>Why am I seeing this?</summary>
          <p>These statements are generated from the displayed records only. They compare selected years and areas, suppress unsupported data, and avoid causal or fish-population claims.</p>
        </details>
      </section>
      <details class="methodology">
        <summary>Methodology and source</summary>
        <div>
          <p><strong>Dataset:</strong> Recreational fishing catch and effort in Everglades National Park, 1980-2025, from the National Park Service IRMA data package.</p>
          <p><strong>Coverage:</strong> ${data.metadata.date_coverage.min_date} through ${data.metadata.date_coverage.max_date}. The default view is ${data.metadata.date_coverage.default_start_year}-${data.metadata.date_coverage.default_end_year}; 2025 is selectable but marked partial.</p>
          <p><strong>CPUE:</strong> ${data.metadata.cpue.formula}. Unit: ${data.metadata.cpue.unit}. ${data.metadata.cpue.limitation}</p>
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
    update();
  });
  document.querySelector<HTMLButtonElement>("#showAllAreasButton")!.addEventListener("click", () => {
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
  renderTakeaways(records);
  renderMap();
  fisheriesMap?.invalidate();
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

function renderTakeaways(records: DisplayRecord[]): void {
  const takeaways = buildTakeaways(records, state.metric, state.startYear, state.endYear);
  document.querySelector("#takeaways")!.innerHTML = takeaways.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
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
    <table>
      <caption>Mapped area values for ${latestYear}</caption>
      <thead><tr><th>Area</th><th>${metricLabels[state.metric]}</th><th>Catch</th><th>Effort</th><th>Coverage</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5">No mapped areas match the active selection.</td></tr>'}</tbody>
    </table>
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
