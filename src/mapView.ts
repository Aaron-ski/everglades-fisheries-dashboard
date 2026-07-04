import L from "leaflet";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { formatValue, metricLabels, metricUnits } from "./metrics";
import type { DisplayRecord, MetricKey } from "./types";

export class FisheriesMap {
  private map: L.Map;
  private layer: L.GeoJSON;
  private records = new Map<string, DisplayRecord>();
  private selectedArea = "all";
  private metric: MetricKey = "cpue";
  private onAreaSelect: (areaCode: string) => void;

  constructor(element: HTMLElement, geojson: FeatureCollection, onAreaSelect: (areaCode: string) => void) {
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
          click: () => {
            const code = String(feature.properties?.area_code ?? "");
            this.selectedArea = code;
            this.onAreaSelect(code);
            this.layer.setStyle((item) => this.styleFeature(item as Feature<Geometry>));
          }
        });
        layer.bindTooltip(String(feature.properties?.area_name ?? "Fishing area"));
      }
    }).addTo(this.map);
    this.map.fitBounds(this.layer.getBounds(), { padding: [18, 18] });
  }

  update(records: DisplayRecord[], metric: MetricKey, selectedArea: string): void {
    this.metric = metric;
    this.selectedArea = selectedArea;
    this.records = new Map(records.filter((record) => record.areaCode).map((record) => [record.areaCode as string, record]));
    this.layer.eachLayer((layer) => {
      const feature = (layer as L.Layer & { feature?: Feature }).feature;
      if (!feature) return;
      const code = String(feature.properties?.area_code ?? "");
      const record = this.records.get(code);
      const popup = this.popupHtml(feature, record);
      (layer as L.Path).setStyle(this.styleFeature(feature as Feature<Geometry>));
      layer.bindPopup(popup);
    });
  }

  invalidate(): void {
    setTimeout(() => this.map.invalidateSize(), 50);
  }

  private styleFeature(feature: Feature<Geometry>): L.PathOptions {
    const code = String(feature.properties?.area_code ?? "");
    const record = this.records.get(code);
    const selected = this.selectedArea === code;
    const value = record?.value;
    const missing = value === null || value === undefined;
    const zero = value === 0;
    return {
      color: selected ? "#111827" : missing ? "#6b7280" : zero ? "#334155" : "#174b42",
      weight: selected ? 4 : missing ? 2 : 2.5,
      dashArray: missing ? "5 5" : zero ? "1 5" : undefined,
      fillColor: missing ? "#d1d5db" : colorForValue(value ?? 0),
      fillOpacity: missing ? 0.32 : zero ? 0.18 : 0.68
    };
  }

  private popupHtml(feature: Feature<Geometry>, record?: DisplayRecord): string {
    const name = String(feature.properties?.area_name ?? "Fishing area");
    const code = String(feature.properties?.area_code ?? "");
    if (!record) {
      return `<strong>${name}</strong><br>Area ${code}<br>No data for the active selection.`;
    }
    return `<strong>${name}</strong><br>
      Area ${code}<br>
      ${metricLabels[this.metric]}: ${formatValue(record.value, this.metric)} ${metricUnits[this.metric]}<br>
      Catch numerator: ${record.catch.toLocaleString()} fish<br>
      Effort denominator: ${record.effort?.toLocaleString(undefined, { maximumFractionDigits: 1 }) ?? "No data"} angler-hours<br>
      Surveyed trips: ${record.surveyedTrips.toLocaleString()}<br>
      Coverage: ${record.coverageStatus}`;
  }
}

function colorForValue(value: number): string {
  if (value <= 0) return "#f8fafc";
  if (value < 0.05) return "#d6eadf";
  if (value < 0.15) return "#9ccbb5";
  if (value < 0.35) return "#5c9f86";
  if (value < 0.75) return "#28705c";
  return "#174b42";
}
