/** The product-owned MapLibre style document used by the public Atlas map. */
export const ATLAS_BASEMAP_STYLE_URL =
  "https://openmaptiles.github.io/osm-bright-gl-style/style-cdn.json";

function isAbsoluteUrl(value: string): boolean {
  return /^https?:\/\//.test(value);
}

/**
 * Validates a style URL before it reaches MapLibre.
 *
 * Style switching is product UI state, not deployment env. Invalid style URLs
 * fail at the state boundary rather than producing an opaque canvas error.
 *
 * @param value MapLibre style document URL.
 * @returns The validated style URL.
 */
export function requireAbsoluteMapStyleUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || !isAbsoluteUrl(trimmed)) {
    throw new Error("Map style URL must be an absolute http(s) URL.");
  }

  return trimmed;
}
