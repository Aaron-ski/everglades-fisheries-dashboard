import { describe, expect, it } from "vitest";
import { buildTakeaways } from "../../src/takeaways";
import type { DisplayRecord } from "../../src/types";

function record(year: number, label: string, value: number, coverageStatus = "complete year"): DisplayRecord {
  return {
    year,
    label,
    broadRegion: label,
    value,
    catch: value,
    kept: value / 2,
    released: value / 2,
    effort: 100,
    cpue: value / 100,
    releaseRate: 0.5,
    surveyedTrips: 20,
    monthsPresent: coverageStatus === "interrupted survey coverage" ? 10 : 12,
    isPartialYear: false,
    coverageStatus
  };
}

describe("takeaways", () => {
  it("builds deterministic comparison statements", () => {
    const rows = [record(2023, "A", 10), record(2023, "B", 5), record(2024, "A", 12), record(2024, "B", 2)];
    expect(buildTakeaways(rows, "catch", 2023, 2024)[0]).toContain("A had the highest");
  });

  it("suppresses unsupported sparse data", () => {
    const rows = [record(2024, "A", 10, "sparse survey coverage")];
    expect(buildTakeaways(rows, "catch", 2024, 2024)[0]).toContain("No takeaway");
  });
});
