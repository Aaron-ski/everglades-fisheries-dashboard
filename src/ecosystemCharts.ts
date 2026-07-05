import Plotly from "plotly.js-dist-min";
import type { HeatmapCell } from "./ecosystemTypes";

const heatmapColors = [
  [0, "#334155"],
  [0.166, "#b85c38"],
  [0.333, "#dd9b63"],
  [0.5, "#c8c7b0"],
  [0.666, "#7bb6ba"],
  [0.833, "#2d8ca8"],
  [1, "#126782"]
];

const plotConfig: Partial<Plotly.Config> = {
  responsive: true,
  displaylogo: false,
  modeBarButtonsToRemove: ["lasso2d", "select2d"]
};

export function renderEcosystemHeatmap(
  element: HTMLElement,
  cells: HeatmapCell[],
  startYear: number,
  endYear: number,
  selectedKey: string | null,
  onSelect: (key: string) => void
): void {
  const years = range(startYear, endYear);
  const species = [...new Set(cells.map((cell) => cell.species.commonName))];
  const cellLookup = new Map(cells.map((cell) => [heatmapCellKey(cell.species.id, cell.year), cell]));
  const z = species.map((name) =>
    years.map((year) => {
      const cell = cells.find((item) => item.species.commonName === name && item.year === year);
      return cell?.bandIndex ?? 0;
    })
  );
  const text = species.map((name) =>
    years.map((year) => {
      const cell = cells.find((item) => item.species.commonName === name && item.year === year);
      return cell ? heatmapText(cell) : "Limited or missing data";
    })
  );
  const customdata = species.map((name) =>
    years.map((year) => {
      const cell = cells.find((item) => item.species.commonName === name && item.year === year);
      return [cell?.species.id ?? "", year, cell?.band ?? "Limited or missing data"];
    })
  );

  element.style.minWidth = `${Math.max(680, years.length * 38)}px`;
  Plotly.react(
    element,
    [
      ({
        type: "heatmap",
        x: years,
        y: species,
        z,
        text,
        customdata,
        zmin: 0,
        zmax: 6,
        colorscale: heatmapColors,
        showscale: false,
        xgap: 2,
        ygap: 3,
        hovertemplate: "%{text}<extra></extra>"
      } as unknown as Partial<Plotly.PlotData>)
    ],
    {
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(6, 20, 18, 0.96)",
      font: { family: "Inter, system-ui, sans-serif", color: "#e6f0ea" },
      margin: { t: 20, r: 12, b: 54, l: 150 },
      hoverlabel: {
        bgcolor: "#ffffff",
        bordercolor: "#1f2937",
        font: { color: "#111827", family: "Inter, system-ui, sans-serif", size: 13 }
      },
      xaxis: { title: { text: "Year" }, dtick: Math.max(1, Math.ceil(years.length / 14)), gridcolor: "rgba(173, 198, 188, 0.12)" },
      yaxis: { automargin: true, gridcolor: "rgba(173, 198, 188, 0.12)" },
      shapes: selectedKey ? selectedCellShape(selectedKey, species, years, cellLookup) : []
    },
    plotConfig
  );
  const plot = element as HTMLElement & { on?: (event: string, handler: (event: Plotly.PlotMouseEvent) => void) => void; removeAllListeners?: (event: string) => void };
  plot.removeAllListeners?.("plotly_click");
  plot.on?.("plotly_click", (event) => {
    const point = event.points[0];
    const data = point.customdata as unknown as [string, number, string];
    if (data[0]) onSelect(heatmapCellKey(data[0], data[1]));
  });
}

export function heatmapCellKey(speciesId: string, year: number): string {
  return `${speciesId}|${year}`;
}

function heatmapText(cell: HeatmapCell): string {
  return [
    `<b>${cell.species.commonName}</b> (${cell.species.scientificName})`,
    `Year: ${cell.year}${cell.isPartialYear ? " (partial year)" : ""}`,
    `Annual CPUE: ${formatCpue(cell.cpue)} fish per angler-hour`,
    `Percentile: ${cell.percentile === null ? "Limited data" : `${cell.percentile.toFixed(1)}th`}`,
    `Band: ${cell.band}`,
    `Reported catch: ${cell.catch.toLocaleString()} fish`,
    `Effort: ${cell.effort === null ? "No data" : `${cell.effort.toLocaleString(undefined, { maximumFractionDigits: 1 })} angler-hours`}`,
    `Surveyed trips: ${cell.surveyedTrips.toLocaleString()}`,
    `Coverage: ${cell.coverageStatus}`
  ].join("<br>");
}

function selectedCellShape(selectedKey: string, species: string[], years: number[], cellLookup: Map<string, HeatmapCell>): Partial<Plotly.Shape>[] {
  const cell = cellLookup.get(selectedKey);
  if (!cell) return [];
  const yIndex = species.indexOf(cell.species.commonName);
  const xIndex = years.indexOf(cell.year);
  if (yIndex === -1 || xIndex === -1) return [];
  return [
    {
      type: "rect",
      xref: "x",
      yref: "y",
      x0: cell.year - 0.5,
      x1: cell.year + 0.5,
      y0: yIndex - 0.5,
      y1: yIndex + 0.5,
      line: { color: "#f2c365", width: 3 },
      fillcolor: "rgba(0,0,0,0)"
    }
  ];
}

function range(start: number, end: number): number[] {
  if (end < start) return [];
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function formatCpue(value: number | null): string {
  return value === null ? "No data" : value.toFixed(3);
}
