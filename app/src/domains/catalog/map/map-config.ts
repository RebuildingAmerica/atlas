import type { StyleSpecification } from "maplibre-gl";
import type { DeviceColorScheme } from "@/domains/catalog/hooks/use-device-color-scheme";

export const ATLAS_BASEMAP_BACKGROUND_TOKEN = "--color-page-bg";

interface AtlasBasemapStyleOptions {
  backgroundColor?: string;
}

/** The product-owned MapLibre style used by the public Atlas map. */
export function atlasBasemapStyle(
  scheme: DeviceColorScheme,
  options: AtlasBasemapStyleOptions = {},
): StyleSpecification {
  const tileTheme = scheme === "dark" ? "dark_all" : "light_all";
  const paperColor = options.backgroundColor ?? "transparent";
  const rasterOpacity = scheme === "dark" ? 0.82 : 0.92;
  const rasterSaturation = scheme === "dark" ? -0.35 : -0.55;
  const rasterContrast = scheme === "dark" ? -0.05 : -0.08;

  return {
    version: 8,
    sources: {
      "atlas-basemap": {
        type: "raster",
        tiles: [
          `https://a.basemaps.cartocdn.com/${tileTheme}/{z}/{x}/{y}.png`,
          `https://b.basemaps.cartocdn.com/${tileTheme}/{z}/{x}/{y}.png`,
          `https://c.basemaps.cartocdn.com/${tileTheme}/{z}/{x}/{y}.png`,
          `https://d.basemaps.cartocdn.com/${tileTheme}/{z}/{x}/{y}.png`,
        ],
        tileSize: 256,
        attribution: "© OpenStreetMap contributors © CARTO",
      },
    },
    layers: [
      {
        id: "atlas-paper",
        type: "background",
        paint: {
          "background-color": paperColor,
        },
      },
      {
        id: "atlas-basemap",
        type: "raster",
        source: "atlas-basemap",
        paint: {
          "raster-opacity": rasterOpacity,
          "raster-saturation": rasterSaturation,
          "raster-contrast": rasterContrast,
        },
      },
    ],
  };
}

export const ATLAS_BASEMAP_STYLE: StyleSpecification = atlasBasemapStyle("light");
