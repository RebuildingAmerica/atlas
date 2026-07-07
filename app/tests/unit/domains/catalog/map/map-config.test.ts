import { describe, expect, it } from "vitest";
import { ATLAS_BASEMAP_STYLE } from "@/domains/catalog/map/map-config";

describe("ATLAS_BASEMAP_STYLE", () => {
  it("is an inline raster style rather than a remote style document", () => {
    expect(ATLAS_BASEMAP_STYLE.version).toBe(8);
    expect(ATLAS_BASEMAP_STYLE.sources).toHaveProperty("atlas-basemap");
    expect(ATLAS_BASEMAP_STYLE.layers.map((layer) => layer.id)).toContain("atlas-basemap");
  });

  it("loads geography from direct raster tile templates, not restricted tilejson", () => {
    const source = ATLAS_BASEMAP_STYLE.sources["atlas-basemap"];

    if (source?.type !== "raster") {
      throw new TypeError("Expected atlas-basemap to be a raster source.");
    }

    expect(source.type).toBe("raster");
    expect(source).not.toHaveProperty("url");
    expect(source.tiles).toEqual([
      "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
      "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
      "https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
      "https://d.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
    ]);
    expect(source.attribution).toContain("OpenStreetMap");
  });
});
