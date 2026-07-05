import type { AreaMode } from "./types";

export interface IndicatorSpecies {
  id: string;
  commonName: string;
  scientificName: string;
  initials: string;
}

export const INDICATOR_COMPOSITE_ID = "composite";

export const INDICATOR_SPECIES: IndicatorSpecies[] = [
  {
    id: "centropomus-undecimalis-common-snook",
    commonName: "Common Snook",
    scientificName: "Centropomus undecimalis",
    initials: "CS"
  },
  {
    id: "sciaenops-ocellatus-red-drum",
    commonName: "Red Drum",
    scientificName: "Sciaenops ocellatus",
    initials: "RD"
  },
  {
    id: "cynoscion-nebulosus-spotted-seatrout",
    commonName: "Spotted Seatrout",
    scientificName: "Cynoscion nebulosus",
    initials: "ST"
  },
  {
    id: "lutjanus-griseus-gray-snapper",
    commonName: "Gray Snapper",
    scientificName: "Lutjanus griseus",
    initials: "GS"
  }
];

export type EcosystemIndicatorId = typeof INDICATOR_COMPOSITE_ID | (typeof INDICATOR_SPECIES)[number]["id"];

export type ConditionCategory = "Above Average" | "Near Average" | "Below Average" | "Insufficient Data";
export type TrendCategory = "Increasing" | "Stable" | "Decreasing" | "Insufficient Data";
export type ConfidenceCategory = "High" | "Medium" | "Low";
export type HeatmapBand =
  | "Below 10th percentile"
  | "10th-25th percentile"
  | "25th-50th percentile"
  | "50th-75th percentile"
  | "75th-90th percentile"
  | "Above 90th percentile"
  | "Limited or missing data";

export type AnomalyCategory =
  | "Greater than +50%"
  | "+25% to +50%"
  | "+10% to +25%"
  | "-10% to +10%"
  | "-25% to -10%"
  | "-50% to -25%"
  | "Less than -50%"
  | "Limited data";

export interface EcosystemScope {
  areaMode: AreaMode;
  selectedRegions: string[];
  selectedAreas: string[];
  mappedAreaCodes: string[];
}

export interface AnnualSignal {
  speciesId: string;
  year: number;
  catch: number;
  effort: number | null;
  cpue: number | null;
  surveyedTrips: number;
  monthsPresent: number | null;
  isPartialYear: boolean;
  coverageStatus: string;
  contributingAreas: string[];
}

export interface RecentWindow {
  recentStart: number;
  recentEnd: number;
  years: number[];
  excludedPartialEndYear: boolean;
}

export interface BaselineWindow extends RecentWindow {
  baselineStart: number;
  baselineEnd: number;
}

export interface ScorecardRow {
  species: IndicatorSpecies;
  annual: AnnualSignal[];
  currentCpue: number | null;
  currentCatch: number;
  currentEffort: number | null;
  percentile: number | null;
  condition: ConditionCategory;
  trend: TrendCategory;
  normalizedTrend: number | null;
  confidence: ConfidenceCategory;
  confidenceReason: string;
  recentWindow: RecentWindow;
  validYears: number;
  eligibleYears: number;
  recentValidYears: number;
}

export interface HeatmapCell {
  species: IndicatorSpecies;
  year: number;
  cpue: number | null;
  percentile: number | null;
  band: HeatmapBand;
  bandIndex: number;
  limited: boolean;
  catch: number;
  effort: number | null;
  surveyedTrips: number;
  coverageStatus: string;
  isPartialYear: boolean;
}

export interface SpeciesAnomaly {
  species: IndicatorSpecies;
  recentCpue: number | null;
  baselineCpue: number | null;
  anomalyPercent: number | null;
  reason: string | null;
}

export interface AnomalyArea {
  areaCode: string;
  areaName: string;
  broadRegion: string;
  recentCpue: number | null;
  baselineCpue: number | null;
  anomalyPercent: number | null;
  category: AnomalyCategory;
  recentCatch: number;
  recentEffort: number | null;
  baselineCatch: number;
  baselineEffort: number | null;
  surveyedTrips: number;
  validContributingSpecies: number;
  speciesAnomalies: SpeciesAnomaly[];
  confidence: ConfidenceCategory;
  coverageWarnings: string[];
  isActive: boolean;
}

