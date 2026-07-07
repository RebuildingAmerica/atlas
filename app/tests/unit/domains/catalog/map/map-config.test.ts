import { describe, expect, it } from "vitest";
import {
  ATLAS_BASEMAP_STYLE_URL,
  requireAbsoluteMapStyleUrl,
} from "@/domains/catalog/map/map-config";

describe("ATLAS_BASEMAP_STYLE_URL", () => {
  it("is the versioned basemap style used by the public map", () => {
    expect(ATLAS_BASEMAP_STYLE_URL).toBe(
      "https://openmaptiles.github.io/osm-bright-gl-style/style-cdn.json",
    );
  });

  it("is an absolute HTTPS style document URL", () => {
    const url = new URL(ATLAS_BASEMAP_STYLE_URL);
    expect(url.protocol).toBe("https:");
    expect(url.pathname.endsWith(".json")).toBe(true);
  });

  it("rejects invalid style updates", () => {
    expect(() => requireAbsoluteMapStyleUrl("/maps/atlas/style.json")).toThrow(
      "Map style URL must be an absolute http(s) URL.",
    );
  });
});
