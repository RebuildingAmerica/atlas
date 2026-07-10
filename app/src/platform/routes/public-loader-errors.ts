/**
 * Public catalog loaders should not turn transient API outages into route
 * crashes. Coding errors still need to throw so they stay visible in dev.
 */
export function isRecoverablePublicLoaderError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const status = readErrorStatus(error);

  return (
    error.message.includes("Atlas is temporarily unavailable") ||
    (typeof status === "number" && status >= 500) ||
    error.name === "HTTPError" ||
    error.message === "HTTPError"
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
