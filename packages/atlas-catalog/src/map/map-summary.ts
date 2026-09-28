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
