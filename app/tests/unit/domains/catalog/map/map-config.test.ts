import { describe, expect, it } from "vitest";
import { atlasBasemapStyle } from "@/domains/catalog/map/map-config";

describe("atlasBasemapStyle", () => {
  it("is an inline raster style rather than a remote style document", () => {
    const style = atlasBasemapStyle("light");

    expect(style.version).toBe(8);
    expect(style.sources).toHaveProperty("atlas-basemap");
    expect(style.layers.map((layer) => layer.id)).toContain("atlas-basemap");
  });

  it("loads the light device-theme geography from direct raster tile templates", () => {
    const source = atlasBasemapStyle("light").sources["atlas-basemap"];

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

  it("loads dark device-theme geography from the dark CARTO raster tiles", () => {
    const source = atlasBasemapStyle("dark").sources["atlas-basemap"];

    if (source?.type !== "raster") {
      throw new TypeError("Expected atlas-basemap to be a raster source.");
    }

    expect(source.tiles).toEqual([
      "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
      "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
      "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
      "https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
    ]);
  });

  it("uses the resolved semantic page background for the map paper layer", () => {
    const style = atlasBasemapStyle("dark", { backgroundColor: "rgb(23, 19, 15)" });
    const layer = style.layers.find((candidate) => candidate.id === "atlas-paper");

    if (layer?.type !== "background") {
      throw new TypeError("Expected atlas-paper to be a background layer.");
    }

    expect(layer.paint?.["background-color"]).toBe("rgb(23, 19, 15)");
    expect(JSON.stringify(style)).not.toContain("#17130f");
    expect(JSON.stringify(style)).not.toContain("#f7f3ea");
  });
});
