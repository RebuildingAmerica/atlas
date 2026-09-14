// A request that timed out or was rate limited will succeed if tried again,
// like a server error and unlike a 404 or a validation failure.
const RETRYABLE_STATUSES = new Set([408, 425, 429]);

/**
 * Public catalog loaders should not turn transient API outages into route
 * crashes. Coding errors still need to throw so they stay visible in dev.
 *
 * An outage is anything a later retry can fix: a server error, a timeout, a
 * rate limit, or a request that never reached the API.
 */
export function isRecoverablePublicLoaderError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const status = readErrorStatus(error);

  return (
    error.message.includes("Atlas is temporarily unavailable") ||
    (typeof status === "number" && (status >= 500 || RETRYABLE_STATUSES.has(status))) ||
    error.name === "HTTPError" ||
    error.message === "HTTPError" ||
    (error instanceof TypeError && error.message === "fetch failed")
  );
}

function readErrorStatus(error: Error): number | null {
  const status = (error as Error & { status?: unknown }).status;
  if (typeof status === "number") {
    return status;
  }

  const response = (error as Error & { response?: { status?: unknown } }).response;
  if (typeof response?.status === "number") {
    return response.status;
  }

  return null;
}
