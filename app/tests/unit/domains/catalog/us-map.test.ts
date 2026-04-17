import { describe, expect, it } from "vitest";
import { buildUsMapStateStyles, getStateCodeFromFips } from "@/domains/catalog/us-map";

describe("getStateCodeFromFips", () => {
  it("maps Census FIPS ids to Atlas state codes", () => {
    expect(getStateCodeFromFips("06")).toBe("CA");
    expect(getStateCodeFromFips("36")).toBe("NY");
    expect(getStateCodeFromFips("11")).toBe("DC");
  });

  it("returns undefined for unknown ids", () => {
    expect(getStateCodeFromFips("99")).toBeUndefined();
  });

  it("returns undefined when a FIPS code is absent", () => {
    expect(getStateCodeFromFips(undefined)).toBeUndefined();
  });
});

describe("buildUsMapStateStyles", () => {
  it("joins state density data onto state codes", () => {
    expect(
      buildUsMapStateStyles([
        { state: "CA", count: 12, intensity: 1 },
        { state: "MO", count: 4, intensity: 0.33 },
      ]),
    ).toEqual({
      CA: { count: 12, intensity: 1 },
      MO: { count: 4, intensity: 0.33 },
    });
  });
});
