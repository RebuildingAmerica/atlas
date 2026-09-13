import type { ExpressionSpecification, LayerSpecification, StyleSpecification } from "maplibre-gl";
import type { DeviceColorScheme } from "@/domains/catalog/hooks/use-device-color-scheme";

export const ATLAS_BASEMAP_BACKGROUND_TOKEN = "--color-page-bg";

/**
 * OpenStreetMap vector tiles served by OpenFreeMap.
 *
 * OpenFreeMap needs no key and no account and permits production use, which is
 * why it replaced CARTO's raster tiles: CARTO began stamping "API KEY REQUIRED"
 * across every tile, so the flagship map showed a watermark under its data.
 * The source is a TileJSON document rather than fixed tile templates because
 * OpenFreeMap publishes each weekly planet build under a dated path.
 */
export const ATLAS_BASEMAP_TILEJSON_URL = "https://tiles.openfreemap.org/planet";
const ATLAS_BASEMAP_GLYPHS_URL = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";

interface AtlasBasemapStyleOptions {
  backgroundColor?: string;
}

interface BasemapPalette {
  water: string;
  waterway: string;
  countryBoundary: string;
  stateBoundary: string;
  road: string;
  label: string;
  labelHalo: string;
}

// Muted on purpose: the basemap is paper for the actor dots, so it carries no
// fill for land, no buildings, and no minor roads, and its lines stay lighter
// than any marker drawn over them.
const PALETTES: Record<DeviceColorScheme, BasemapPalette> = {
  light: {
    water: "hsl(205, 22%, 86%)",
    waterway: "hsl(205, 22%, 82%)",
    countryBoundary: "hsl(30, 8%, 62%)",
    stateBoundary: "hsl(30, 8%, 74%)",
    road: "hsl(30, 10%, 88%)",
    label: "hsl(30, 8%, 38%)",
    labelHalo: "hsla(40, 30%, 97%, 0.9)",
  },
  dark: {
    water: "hsl(210, 18%, 17%)",
    waterway: "hsl(210, 18%, 20%)",
    countryBoundary: "hsl(30, 6%, 42%)",
    stateBoundary: "hsl(30, 6%, 30%)",
    road: "hsl(30, 6%, 22%)",
    label: "hsl(35, 10%, 68%)",
    labelHalo: "hsla(30, 15%, 8%, 0.85)",
  },
};

const NAME: ExpressionSpecification = ["coalesce", ["get", "name_en"], ["get", "name"]];

function labelLayer(
  id: string,
  placeClass: string,
  palette: BasemapPalette,
  zoom: { min: number; max?: number },
  size: ExpressionSpecification,
  font: string,
): LayerSpecification {
  return {
    id,
    type: "symbol",
    source: "atlas-basemap",
    "source-layer": "place",
    minzoom: zoom.min,
    ...(zoom.max === undefined ? {} : { maxzoom: zoom.max }),
    filter: ["==", ["get", "class"], placeClass],
    layout: {
      "text-field": NAME,
      "text-font": [font],
      "text-size": size,
      "text-max-width": 8,
    },
    paint: {
      "text-color": palette.label,
      "text-halo-color": palette.labelHalo,
      "text-halo-width": 1.2,
    },
  };
}

/** The product-owned MapLibre style used by the public Atlas map. */
export function atlasBasemapStyle(
  scheme: DeviceColorScheme,
  options: AtlasBasemapStyleOptions = {},
): StyleSpecification {
  const palette = PALETTES[scheme];
  const paperColor = options.backgroundColor ?? "transparent";

  return {
    version: 8,
    glyphs: ATLAS_BASEMAP_GLYPHS_URL,
    sources: {
      "atlas-basemap": {
        type: "vector",
        url: ATLAS_BASEMAP_TILEJSON_URL,
        attribution:
          '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
      },
    },
    layers: [
      {
        id: "atlas-paper",
        type: "background",
        paint: { "background-color": paperColor },
      },
      {
        id: "atlas-water",
        type: "fill",
        source: "atlas-basemap",
        "source-layer": "water",
        filter: ["!=", ["get", "brunnel"], "tunnel"],
        paint: { "fill-color": palette.water },
      },
      {
        id: "atlas-waterway",
        type: "line",
        source: "atlas-basemap",
        "source-layer": "waterway",
        minzoom: 8,
        paint: { "line-color": palette.waterway },
      },
      {
        id: "atlas-roads",
        type: "line",
        source: "atlas-basemap",
        "source-layer": "transportation",
        minzoom: 6,
        filter: ["match", ["get", "class"], ["motorway", "trunk", "primary"], true, false],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": palette.road,
          "line-width": ["interpolate", ["exponential", 1.4], ["zoom"], 6, 0.5, 14, 4],
        },
      },
      {
        id: "atlas-state-boundaries",
        type: "line",
        source: "atlas-basemap",
        "source-layer": "boundary",
        minzoom: 3,
        filter: ["all", ["==", ["get", "admin_level"], 4], ["!=", ["get", "maritime"], 1]],
        paint: {
          "line-color": palette.stateBoundary,
          "line-dasharray": [2, 2],
          "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.6, 10, 1.4],
        },
      },
      {
        id: "atlas-country-boundaries",
        type: "line",
        source: "atlas-basemap",
        "source-layer": "boundary",
        filter: ["all", ["==", ["get", "admin_level"], 2], ["!=", ["get", "maritime"], 1]],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": palette.countryBoundary,
          "line-width": ["interpolate", ["linear"], ["zoom"], 2, 0.8, 10, 2],
        },
      },
      labelLayer(
        "atlas-state-labels",
        "state",
        palette,
        { min: 4, max: 8 },
        ["interpolate", ["linear"], ["zoom"], 4, 10, 8, 13],
        "Noto Sans Italic",
      ),
      labelLayer(
        "atlas-city-labels",
        "city",
        palette,
        { min: 5 },
        ["interpolate", ["linear"], ["zoom"], 5, 11, 12, 16],
        "Noto Sans Regular",
      ),
      labelLayer(
        "atlas-town-labels",
        "town",
        palette,
        { min: 9 },
        ["interpolate", ["linear"], ["zoom"], 9, 11, 14, 14],
        "Noto Sans Regular",
      ),
    ],
  };
}

export const ATLAS_BASEMAP_STYLE: StyleSpecification = atlasBasemapStyle("light");
