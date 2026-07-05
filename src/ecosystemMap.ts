import L from "leaflet";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { INDICATOR_COMPOSITE_ID, INDICATOR_SPECIES, type AnomalyArea, type BaselineWindow, type EcosystemIndicatorId } from "./ecosystemTypes";

export class EcosystemAnomalyMap {
  private map: L.Map;
  private layer: L.GeoJSON;
  private records = new Map<string, AnomalyArea>();
  private selectedAreas = new Set<string>();
  private indicatorId: EcosystemIndicatorId = INDICATOR_COMPOSITE_ID;
  private window: BaselineWindow | null = null;
  private onAreaSelect: (areaCode: string, additive: boolean) => void;

  constructor(element: HTMLElement, geojson: FeatureCollection, onAreaSelect: (areaCode: string, additive: boolean) => void) {
    this.onAreaSelect = onAreaSelect;
    this.map = L.map(element, { scrollWheelZoom: false }).setView([25.25, -80.95], 9);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 14,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(this.map);
    this.layer = L.geoJSON(geojson, {
      style: (feature) => this.styleFeature(feature as Feature<Geometry>),
      onEachFeature: (feature, layer) => {
        layer.on({
          click: (event) => {
            const code = String(feature.properties?.area_code ?? "");
            const originalEvent = event.originalEvent as MouseEvent;
            this.onAreaSelect(code, originalEvent.ctrlKey || originalEvent.metaKey);
            this.layer.setStyle((item) => this.styleFeature(item as Feature<Geometry>));
          }
        });
        layer.bindTooltip(String(feature.properties?.area_name ?? "Fishing area"));
      }
    }).addTo(this.map);
    this.map.fitBounds(this.layer.getBounds(), { padding: [18, 18] });
  }

  update(records: AnomalyArea[], indicatorId: EcosystemIndicatorId, window: BaselineWindow, selectedAreas: string[]): void {
    this.records = new Map(records.map((record) => [record.areaCode, record]));
    this.selectedAreas = new Set(selectedAreas);
    this.indicatorId = indicatorId;
    this.window = window;
    this.layer.eachLayer((layer) => {
      const feature = (layer as L.Layer & { feature?: Feature }).feature;
      if (!feature) return;
      const code = String(feature.properties?.area_code ?? "");
      const record = this.records.get(code);
      (layer as L.Path).setStyle(this.styleFeature(feature as Feature<Geometry>));
      layer.bindPopup(this.popupHtml(feature, record));
    });
  }

  invalidate(): void {
    setTimeout(() => this.map.invalidateSize(), 50);
  }

  private styleFeature(feature: Feature<Geometry>): L.PathOptions {
    const code = String(feature.properties?.area_code ?? "");
    const record = this.records.get(code);
    const selected = this.selectedAreas.has(code);
    const limited = !record || !record.isActive || record.anomalyPercent === null;
    return {
      color: selected ? "#f8fafc" : limited ? "#94a3b8" : "#0f172a",
      weight: selected ? 4 : limited ? 2 : 2.5,
      dashArray: limited ? "5 5" : undefined,
      fillColor: record ? colorForAnomaly(record.category) : "#d1d5db",
      fillOpacity: limited ? 0.28 : 0.72
    };
  }

  private popupHtml(feature: Feature<Geometry>, record?: AnomalyArea): string {
    const name = String(feature.properties?.area_name ?? "Fishing area");
    const code = String(feature.properties?.area_code ?? "");
    const indicator = indicatorLabel(this.indicatorId);
    if (!record || !this.window) {
      return `<strong>${name}</strong><br>Area ${code}<br>No anomaly data for this area.`;
    }
    const speciesLines = record.speciesAnomalies
      .map((item) => `${item.species.commonName}: ${formatPercent(item.anomalyPercent)}${item.reason ? ` (${item.reason})` : ""}`)
      .join("<br>");
    return `<strong>${name}</strong><br>
      Area ${code}; ${record.broadRegion}<br>
      Indicator: ${indicator}<br>
      Recent period: ${this.window.recentStart}-${this.window.recentEnd}; CPUE ${formatCpue(record.recentCpue)}<br>
      Baseline: ${this.window.baselineStart}-${this.window.baselineEnd}; CPUE ${formatCpue(record.baselineCpue)}<br>
      Anomaly: ${formatPercent(record.anomalyPercent)} (${record.category})<br>
      Recent catch/effort: ${record.recentCatch.toLocaleString()} fish / ${formatEffort(record.recentEffort)}<br>
      Baseline catch/effort: ${record.baselineCatch.toLocaleString()} fish / ${formatEffort(record.baselineEffort)}<br>
      Surveyed trips: ${record.surveyedTrips.toLocaleString()}<br>
      Contributing species: ${record.validContributingSpecies}<br>
      Coverage: ${record.coverageWarnings.join("; ") || "No warnings"}<br>
      ${speciesLines}`;
  }
}

export function colorForAnomaly(category: string): string {
  switch (category) {
    case "Greater than +50%":
      return "#15803d";
    case "+25% to +50%":
      return "#4ade80";
    case "+10% to +25%":
      return "#bef264";
    case "-10% to +10%":
      return "#facc15";
    case "-25% to -10%":
      return "#f97316";
    case "-50% to -25%":
      return "#dc2626";
    case "Less than -50%":
      return "#991b1b";
    default:
      return "#64748b";
  }
}

export function indicatorLabel(indicatorId: EcosystemIndicatorId): string {
  if (indicatorId === INDICATOR_COMPOSITE_ID) return "Indicator-species composite";
  return INDICATOR_SPECIES.find((species) => species.id === indicatorId)?.commonName ?? "Indicator species";
}

function formatCpue(value: number | null): string {
  return value === null ? "No data" : `${value.toFixed(3)} fish per angler-hour`;
}

function formatEffort(value: number | null): string {
  return value === null ? "No data" : `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} angler-hours`;
}

function formatPercent(value: number | null): string {
  return value === null ? "Limited data" : `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}
