/**
 * Public catalog loaders should not turn transient API outages into route
 * crashes. Coding errors still need to throw so they stay visible in dev.
 */
export function isRecoverablePublicLoaderError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.includes("Atlas is temporarily unavailable");
}
