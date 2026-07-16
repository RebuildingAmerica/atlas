/**
 * Returns the candidate path when it is safe to use as an app-local redirect.
 */
export function sanitizeAtlasRedirectPath(
  candidate: string | undefined,
): string | null {
  if (!candidate || typeof candidate !== "string") {
    return null;
  }

  if (candidate.length === 0 || candidate.length > 2048) {
    return null;
  }

  if (!candidate.startsWith("/")) {
    return null;
  }

  if (candidate.startsWith("//") || candidate.startsWith("/\\")) {
    return null;
  }

  return candidate;
}
