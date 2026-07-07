import type { StyleSpecification } from "maplibre-gl";

/** The product-owned MapLibre style used by the public Atlas map. */
export const ATLAS_BASEMAP_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    "atlas-basemap": {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
        "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
        "https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
        "https://d.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
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
        "background-color": "#f7f3ea",
      },
    },
    {
      id: "atlas-basemap",
      type: "raster",
      source: "atlas-basemap",
      paint: {
        "raster-opacity": 0.92,
        "raster-saturation": -0.55,
        "raster-contrast": -0.08,
      },
    },
  ],
};
