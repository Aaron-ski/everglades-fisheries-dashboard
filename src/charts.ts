import Plotly from "plotly.js-dist-min";
import { formatValue, metricLabels, metricUnits } from "./metrics";
import type { DisplayRecord, MetricKey } from "./types";

const plotConfig: Partial<Plotly.Config> = {
  responsive: true,
  displaylogo: false,
  modeBarButtonsToRemove: ["lasso2d", "select2d"]
};

const layoutBase: Partial<Plotly.Layout> = {
  paper_bgcolor: "rgba(0,0,0,0)",
  plot_bgcolor: "rgba(255,255,255,0.92)",
  font: { family: "Inter, system-ui, sans-serif", color: "#17201a" },
  margin: { t: 34, r: 24, b: 52, l: 62 },
  hovermode: "x unified",
  legend: { orientation: "h", y: -0.24 }
};

export function renderTrendChart(element: HTMLElement, records: DisplayRecord[], metric: MetricKey): void {
  const labels = [...new Set(records.map((record) => record.label))].sort();
  const traces = labels.map((label) => {
    const rows = records.filter((record) => record.label === label).sort((a, b) => a.year - b.year);
    return {
      type: "scatter",
      mode: "lines+markers",
      name: label,
      x: rows.map((row) => row.year),
      y: rows.map((row) => row.value),
      customdata: rows.map((row) => [
        row.catch,
        row.effort,
        row.surveyedTrips,
        row.coverageStatus,
        row.monthsPresent,
        row.isPartialYear ? "partial year" : ""
      ]),
      hovertemplate:
        "%{x}<br>%{fullData.name}<br>" +
        `${metricLabels[metric]}: %{y}<br>` +
        "Catch: %{customdata[0]:,}<br>" +
        "Effort: %{customdata[1]:,.1f}<br>" +
        "Surveyed trips: %{customdata[2]:,}<br>" +
        "Coverage: %{customdata[3]}<extra></extra>"
    } satisfies Partial<Plotly.PlotData>;
  });
  if (traces.length === 0) {
    element.innerHTML = '<div class="empty-state">No trend data is available for this selection.</div>';
    return;
  }
  Plotly.react(element, traces, {
    ...layoutBase,
    yaxis: { title: { text: `${metricLabels[metric]} (${metricUnits[metric]})` }, rangemode: "tozero" },
    xaxis: { title: { text: "Year" }, dtick: 2 },
    shapes: partialYearShapes(records)
  }, plotConfig);
}

export function renderEffortChart(element: HTMLElement, records: DisplayRecord[]): void {
  const labels = [...new Set(records.map((record) => record.label))].sort();
  const traces = labels.map((label) => {
    const rows = records.filter((record) => record.label === label).sort((a, b) => a.year - b.year);
    return {
      type: "bar",
      name: label,
      x: rows.map((row) => row.year),
      y: rows.map((row) => row.effort),
      customdata: rows.map((row) => [row.surveyedTrips, row.coverageStatus]),
      hovertemplate: "%{x}<br>%{fullData.name}<br>Angler-hours: %{y:,.1f}<br>Surveyed trips: %{customdata[0]:,}<br>%{customdata[1]}<extra></extra>"
    } satisfies Partial<Plotly.PlotData>;
  });
  Plotly.react(element, traces, {
    ...layoutBase,
    barmode: "group",
    yaxis: { title: { text: "Angler-hours" }, rangemode: "tozero" },
    xaxis: { title: { text: "Year" }, dtick: 2 }
  }, plotConfig);
}

export function renderKeptReleasedChart(element: HTMLElement, records: DisplayRecord[]): void {
  const byYear = new Map<number, { kept: number; released: number; releaseRate: number | null }>();
  for (const record of records) {
    const current = byYear.get(record.year) ?? { kept: 0, released: 0, releaseRate: null };
    current.kept += record.kept;
    current.released += record.released;
    const denominator = current.kept + current.released;
    current.releaseRate = denominator > 0 ? current.released / denominator : null;
    byYear.set(record.year, current);
  }
  const years = [...byYear.keys()].sort((a, b) => a - b);
  if (years.length === 0) {
    element.innerHTML = '<div class="empty-state">Kept and released values are not available for this selection.</div>';
    return;
  }
  Plotly.react(element, [
    {
      type: "bar",
      name: "Kept",
      x: years,
      y: years.map((year) => byYear.get(year)?.kept ?? 0),
      marker: { color: "#265c4b" }
    },
    {
      type: "bar",
      name: "Released",
      x: years,
      y: years.map((year) => byYear.get(year)?.released ?? 0),
      marker: { color: "#d1793f" }
    },
    {
      type: "scatter",
      mode: "lines+markers",
      name: "Release rate",
      x: years,
      y: years.map((year) => {
        const value = byYear.get(year)?.releaseRate;
        return value === null || value === undefined ? null : value * 100;
      }),
      yaxis: "y2",
      marker: { color: "#1f4e8c" },
      hovertemplate: "%{x}<br>Release rate: %{y:.1f}%<extra></extra>"
    }
  ], {
    ...layoutBase,
    barmode: "stack",
    yaxis: { title: { text: "Fish" }, rangemode: "tozero" },
    yaxis2: { title: { text: "Release rate (%)" }, overlaying: "y", side: "right", rangemode: "tozero" },
    xaxis: { title: { text: "Year" }, dtick: 2 }
  }, plotConfig);
}

export function summarizeChart(records: DisplayRecord[], metric: MetricKey): string {
  const values = records.filter((record) => record.value !== null);
  if (values.length === 0) return "No supported values are available for this selection.";
  const latestYear = Math.max(...values.map((record) => record.year));
  const latest = values.filter((record) => record.year === latestYear);
  const top = [...latest].sort((a, b) => (b.value ?? 0) - (a.value ?? 0))[0];
  return `${metricLabels[metric]} in ${latestYear}: ${top.label} is highest at ${formatValue(top.value, metric)} ${metricUnits[metric]}.`;
}

function partialYearShapes(records: DisplayRecord[]): Partial<Plotly.Shape>[] {
  const years = [...new Set(records.filter((record) => record.isPartialYear).map((record) => record.year))];
  return years.map((year) => ({
    type: "rect",
    xref: "x",
    yref: "paper",
    x0: year - 0.45,
    x1: year + 0.45,
    y0: 0,
    y1: 1,
    fillcolor: "rgba(166, 115, 44, 0.14)",
    line: { width: 0 }
  }));
}
