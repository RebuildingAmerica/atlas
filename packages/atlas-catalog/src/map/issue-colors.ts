/**
 * The civic-dot color language, shared by the map markers and the sign-in
 * brand panel so an actor's hue means the same thing everywhere in Atlas.
 *
 * Each issue area maps to a low-chroma, warm-stone-adjacent hue chosen so a
 * dense map of actors reads as a calm field of color rather than a clash. The
 * key is the *prefix* of an issue-area slug (`housing-affordability` → `housing`)
 * so the whole family of housing issues shares one color.
 */
export const ISSUE_COLORS: Record<string, string> = {
  housing: "#c2956a",
  labor: "#82aa8c",
  climate: "#64a0be",
  democracy: "#be786e",
  education: "#dcb464",
  health: "#8cb4a0",
};

/**
 * The neutral stone used when an issue area has no dedicated hue — silence,
 * not a guessed color, so the map never invents meaning the catalog can't back.
 */
export const FALLBACK_ISSUE_COLOR = "#a89880";

/**
 * Resolve the display hue for an issue-area slug.
 *
 * Splits on the first hyphen and matches the prefix case-insensitively against
 * {@link ISSUE_COLORS}; an unmapped or empty slug returns
 * {@link FALLBACK_ISSUE_COLOR}.
 *
 * @param issueAreaId The issue-area slug, e.g. `housing-affordability`.
 * @returns A hex color string for the dot or badge.
 */
export function issueColor(issueAreaId: string): string {
  const [prefix] = issueAreaId.split("-");
  if (!prefix) {
    return FALLBACK_ISSUE_COLOR;
  }
  return ISSUE_COLORS[prefix.toLowerCase()] ?? FALLBACK_ISSUE_COLOR;
}
