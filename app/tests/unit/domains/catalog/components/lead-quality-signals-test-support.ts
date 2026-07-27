/**
 * An ISO timestamp a given number of days before now.
 *
 * The recency signal is measured against the wall clock, so the fixtures have
 * to be relative rather than fixed dates that would drift out of their band.
 *
 * @param days - How far back to place the timestamp.
 * @returns The ISO-8601 timestamp.
 */
export function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}
