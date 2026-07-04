import { describe, expect, it } from "vitest";
import { linearSlope, percentChange } from "../../src/metrics";

describe("metric helpers", () => {
  it("does not calculate a percent change from a zero baseline", () => {
    expect(percentChange(0, 10).text).toBe("increased from zero");
    expect(percentChange(0, 10).value).toBeNull();
  });

  it("calculates a simple positive linear slope", () => {
    expect(linearSlope([
      { year: 2020, value: 1 },
      { year: 2021, value: 2 },
      { year: 2022, value: 3 }
    ])).toBeCloseTo(1);
  });
});
