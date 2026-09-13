import { describe, expect, it } from "vitest";
import { ATLAS_BASEMAP_TILEJSON_URL, atlasBasemapStyle } from "@/domains/catalog/map/map-config";

describe("atlasBasemapStyle", () => {
  it("is a style object Atlas owns rather than a remote style document", () => {
    const style = atlasBasemapStyle("light");

    expect(style.version).toBe(8);
    expect(style.sources).toHaveProperty("atlas-basemap");
    expect(style.layers.map((layer) => layer.id)).toContain("atlas-water");
  });

  it("draws geography from keyless OpenStreetMap vector tiles", () => {
    const source = atlasBasemapStyle("light").sources["atlas-basemap"];

    if (source?.type !== "vector") {
      throw new TypeError("Expected atlas-basemap to be a vector source.");
    }

    expect(source.url).toBe(ATLAS_BASEMAP_TILEJSON_URL);
    expect(source.attribution).toContain("OpenStreetMap");
  });

  it("depends on no key, token or restricted demo endpoint", () => {
    // A restricted MapTiler demo key once left the public map blank, and CARTO
    // later watermarked every tile for want of a key.
    for (const scheme of ["light", "dark"] as const) {
      const serialized = JSON.stringify(atlasBasemapStyle(scheme)).toLowerCase();
      expect(serialized).not.toMatch(/key=|token=|access_token|maptiler|cartocdn/);
    }
  });

  it("gives every layer a source the style declares", () => {
    const style = atlasBasemapStyle("dark");
    const declared = new Set(Object.keys(style.sources));

    for (const layer of style.layers) {
      if ("source" in layer) {
        expect(declared.has(layer.source)).toBe(true);
      }
    }
    expect(style.glyphs).toContain("{fontstack}");
  });

  it("colors the map differently for the dark device theme", () => {
    const water = (scheme: "light" | "dark") => {
      const layer = atlasBasemapStyle(scheme).layers.find((c) => c.id === "atlas-water");
      if (layer?.type !== "fill") {
        throw new TypeError("Expected atlas-water to be a fill layer.");
      }
      return layer.paint?.["fill-color"];
    };

    expect(water("dark")).not.toBe(water("light"));
  });

  it("leaves the paper transparent until the page background resolves", () => {
    const layer = atlasBasemapStyle("light").layers.find((c) => c.id === "atlas-paper");

    if (layer?.type !== "background") {
      throw new TypeError("Expected atlas-paper to be a background layer.");
    }

    expect(layer.paint?.["background-color"]).toBe("transparent");
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
