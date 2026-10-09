/**
 * Reads the profile an editor means from what they paste: a full profile
 * address, a path, or the bare slug.
 */
export function profileSlugFrom(address: string): string {
  const trimmed = address.trim();
  const path = /^https?:\/\//i.test(trimmed) ? new URL(trimmed).pathname : trimmed;
  const segments = path.split("/").filter(Boolean);
  const slug = segments.at(-1);
  if (!slug) {
    throw new Error("Paste the profile's address or slug.");
  }
  return decodeURIComponent(slug);
}
