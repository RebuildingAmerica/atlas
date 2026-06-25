import { describe, expect, it } from "vitest";
import { getMapStyleUrl, PLACEHOLDER_MAP_STYLE_URL } from "@/domains/catalog/map/map-config";

describe("getMapStyleUrl", () => {
  it("returns a configured absolute https style URL verbatim", () => {
    const configured = "https://api.maptiler.com/maps/atlas/style.json?key=abc123";
    expect(getMapStyleUrl({ ATLAS_MAP_STYLE_URL: configured })).toBe(configured);
  });

  it("accepts a configured absolute http style URL", () => {
    const configured = "http://tiles.localhost/style.json";
    expect(getMapStyleUrl({ ATLAS_MAP_STYLE_URL: configured })).toBe(configured);
  });

  it("trims surrounding whitespace from a configured value", () => {
    expect(
      getMapStyleUrl({ ATLAS_MAP_STYLE_URL: "  https://api.maptiler.com/maps/atlas/style.json  " }),
    ).toBe("https://api.maptiler.com/maps/atlas/style.json");
  });

  it("falls back to the documented placeholder when unset", () => {
    expect(getMapStyleUrl({})).toBe(PLACEHOLDER_MAP_STYLE_URL);
  });

  it("falls back to the placeholder for a whitespace-only value", () => {
    expect(getMapStyleUrl({ ATLAS_MAP_STYLE_URL: "   " })).toBe(PLACEHOLDER_MAP_STYLE_URL);
  });

  it("rejects a relative configured style URL rather than feeding MapLibre an opaque error", () => {
    expect(() => getMapStyleUrl({ ATLAS_MAP_STYLE_URL: "/maps/atlas/style.json" })).toThrow(
      "ATLAS_MAP_STYLE_URL must be an absolute http(s) URL.",
    );
  });
});
