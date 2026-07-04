import { describe, expect, it } from "vitest";
import { defaultState, stateFromUrl, toQuery } from "../../src/state";
import type { SourceMetadata } from "../../src/types";

const metadata = {
  default_species_id: "spotted",
  regions: ["Florida Bay / Cape Sable", "Whitewater Bay", "Gulf Coast"],
  date_coverage: { default_start_year: 2005, default_end_year: 2024 }
} as SourceMetadata;

describe("state helpers", () => {
  it("returns the required default state", () => {
    expect(defaultState(metadata)).toMatchObject({
      speciesId: "spotted",
      metric: "cpue",
      areaMode: "regions",
      selectedRegions: [],
      selectedAreas: [],
      startYear: 2005,
      endYear: 2024
    });
  });

  it("round-trips supported query parameters", () => {
    const parsed = stateFromUrl(metadata, "?species=red&metric=catch&area=detailed&regions=Gulf+Coast&areas=6N,6C&start=2010&end=2020");
    expect(parsed).toMatchObject({ speciesId: "red", metric: "catch", areaMode: "detailed", selectedRegions: ["Gulf Coast"], selectedAreas: ["6N", "6C"] });
    expect(toQuery(parsed)).toContain("species=red");
    expect(toQuery(parsed)).toContain("areas=6N%2C6C");
  });

  it("normalizes all selected regions to no active filter", () => {
    const parsed = stateFromUrl(
      metadata,
      "?regions=Florida+Bay+%2F+Cape+Sable,Whitewater+Bay,Gulf+Coast"
    );
    expect(parsed.selectedRegions).toEqual([]);
    expect(toQuery(parsed)).not.toContain("regions=");
  });

  it("supports legacy single-detail links", () => {
    const parsed = stateFromUrl(metadata, "?area=detailed&detail=6N");
    expect(parsed.selectedAreas).toEqual(["6N"]);
  });
});
