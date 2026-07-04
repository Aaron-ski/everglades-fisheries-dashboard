import { describe, expect, it } from "vitest";
import { defaultState, stateFromUrl, toQuery } from "../../src/state";
import type { SourceMetadata } from "../../src/types";

const metadata = {
  default_species_id: "spotted",
  date_coverage: { default_start_year: 2005, default_end_year: 2024 }
} as SourceMetadata;

describe("state helpers", () => {
  it("returns the required default state", () => {
    expect(defaultState(metadata)).toMatchObject({
      speciesId: "spotted",
      metric: "cpue",
      areaMode: "regions",
      startYear: 2005,
      endYear: 2024
    });
  });

  it("round-trips supported query parameters", () => {
    const parsed = stateFromUrl(metadata, "?species=red&metric=catch&area=detailed&detail=6N&start=2010&end=2020");
    expect(parsed).toMatchObject({ speciesId: "red", metric: "catch", areaMode: "detailed", detailedArea: "6N" });
    expect(toQuery(parsed)).toContain("species=red");
  });
});
