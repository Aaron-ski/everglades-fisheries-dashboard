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
  plot_bgcolor: "rgba(6, 20, 18, 0.96)",
  font: { family: "Inter, system-ui, sans-serif", color: "#e6f0ea" },
  margin: { t: 34, r: 24, b: 52, l: 62 },
  hovermode: "x unified",
  legend: { orientation: "h", y: -0.24, font: { color: "#d7e6de" } },
  xaxis: { gridcolor: "rgba(173, 198, 188, 0.22)", zerolinecolor: "rgba(173, 198, 188, 0.32)" },
  yaxis: { gridcolor: "rgba(173, 198, 188, 0.22)", zerolinecolor: "rgba(173, 198, 188, 0.32)" }
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
    yaxis: darkAxis(`${metricLabels[metric]} (${metricUnits[metric]})`, true),
    xaxis: darkAxis("Year", false, 2),
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
    yaxis: darkAxis("Angler-hours", true),
    xaxis: darkAxis("Year", false, 2)
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
    yaxis: darkAxis("Fish", true),
    yaxis2: { ...darkAxis("Release rate (%)", true), overlaying: "y", side: "right" },
    xaxis: darkAxis("Year", false, 2)
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
      fillcolor: "rgba(240, 180, 90, 0.16)",
    line: { width: 0 }
  }));
}

function darkAxis(title: string, toZero: boolean, dtick?: number): Partial<Plotly.LayoutAxis> {
  return {
    title: { text: title },
    rangemode: toZero ? "tozero" : undefined,
    dtick,
    color: "#d7e6de",
    gridcolor: "rgba(173, 198, 188, 0.22)",
    zerolinecolor: "rgba(173, 198, 188, 0.32)",
    linecolor: "rgba(173, 198, 188, 0.38)",
    tickfont: { color: "#d7e6de" }
  };
}
