/**
 * Title-cases a raw slug by splitting on `-`/`_`, e.g.
 * `"criminal-justice"` -> `"Criminal Justice"`.
 *
 * Shared fallback humanization for any raw enum-like string this package
 * doesn't have a fixed label for: `TrustBadgeRow` uses it for an
 * unrecognized verification level, and `formatRelationshipLabel` uses it for
 * issue-area ids and unrecognized relationship types. Kept as one small,
 * standalone helper rather than duplicated in both places, since the two
 * call sites need identical behavior and would otherwise be free to
 * silently drift apart.
 */
export function humanizeSlug(slug: string): string {
  return slug
    .split(/[-_]/)
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
