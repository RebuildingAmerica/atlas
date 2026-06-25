/**
 * Basemap configuration for the Atlas map.
 *
 * The vector basemap is served by MapTiler under a single, swappable style URL
 * (`ATLAS_MAP_STYLE_URL`) that already embeds the MapTiler key. Map keys are
 * necessarily client-visible — they ship in the browser so MapLibre can request
 * tiles — so the key is *not* a secret. Protection is **MapTiler domain
 * restriction**: the key in the configured style URL must be locked, in the
 * MapTiler dashboard, to the exact origins Atlas is served from (the production
 * domain plus localhost for dev), so a leaked URL cannot be reused elsewhere.
 *
 * In dev and tests we fall back to a documented, intentionally inert placeholder
 * so the data layer and surface logic can be exercised without a real account —
 * the placeholder renders no tiles but keeps the component contract honest.
 */

interface MapConfigEnv {
  ATLAS_MAP_STYLE_URL?: string;
}

/**
 * A clearly-fake placeholder style URL used when no `ATLAS_MAP_STYLE_URL` is
 * configured. It points at an obviously non-production host so a missing
 * environment value surfaces as "no basemap in dev" rather than a silent,
 * confusing blank — and never masquerades as a real MapTiler endpoint.
 */
export const PLACEHOLDER_MAP_STYLE_URL =
  "https://maptiler.invalid/maps/atlas-placeholder/style.json";

function isAbsoluteUrl(value: string): boolean {
  return /^https?:\/\//.test(value);
}

/**
 * Resolve the basemap style URL MapLibre should load.
 *
 * Reads `ATLAS_MAP_STYLE_URL` (the MapTiler style URL, key included) and falls
 * back to {@link PLACEHOLDER_MAP_STYLE_URL} when unset so local development and
 * the test suite work without a MapTiler account. A configured value must be an
 * absolute `http(s)` URL — we fail loudly rather than feed MapLibre a relative
 * path that would error opaquely at tile-load time.
 *
 * @param env Environment record; defaults to Vite's `import.meta.env`.
 * @returns The absolute style URL for the MapLibre basemap.
 */
export function getMapStyleUrl(env: MapConfigEnv = import.meta.env): string {
  const configured = env.ATLAS_MAP_STYLE_URL?.trim();
  if (!configured) {
    return PLACEHOLDER_MAP_STYLE_URL;
  }

  if (!isAbsoluteUrl(configured)) {
    throw new Error("ATLAS_MAP_STYLE_URL must be an absolute http(s) URL.");
  }

  return configured;
}
