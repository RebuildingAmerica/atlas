import type { MapPoint } from "@/types";

/** Pluralize a noun against a count, English-style. */
function plural(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}

/**
 * Build the friendly "designed sparsity" pill, or `null` when the map is empty.
 *
 * Today's catalog is thin on purpose; rather than letting a handful of dots feel
 * broken, the pill frames them honestly as the start of something — "N actors
 * in M places so far" — counting distinct coordinates as places so the line
 * never overstates reach. With nothing placed there is nothing to celebrate, so
 * the pill is omitted entirely and the empty state speaks instead.
 *
 * @param points The actors currently placed in the viewport.
 * @returns The pill copy, or `null` when there are no actors.
 */
export function sparsityPill(points: MapPoint[]): string | null {
  if (points.length === 0) {
    return null;
  }
  const places = new Set(points.map((point) => `${point.lng},${point.lat}`)).size;
  const groupWord = points.length === 1 ? "person or group" : "people and groups";
  const placeWord = plural(places, "place");
  return `${points.length} ${groupWord} in ${places} ${placeWord}`;
}

/**
 * Phrase the live-region announcement for the actors now visible.
 *
 * Read aloud by screen readers whenever the count changes after a pan, zoom, or
 * filter, so a non-sighted visitor hears the map respond — "Showing 14 civic
 * actors" — and an empty viewport is announced plainly rather than silently.
 *
 * @param count How many actors are placed in the viewport.
 * @returns The text for the `aria-live` region.
 */
export function announceViewport(count: number): string {
  if (count === 0) {
    return "No people or groups here.";
  }
  const groupWord = count === 1 ? "person or group" : "people and groups";
  return `Showing ${count} ${groupWord}.`;
}
