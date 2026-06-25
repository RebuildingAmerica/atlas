/**
 * Typed error codes for Atlas discovery API requests.
 *
 * The string value of each code doubles as `error.message` when an
 * `AtlasApiError` is thrown.  TanStack Start serializes errors across the
 * server-function boundary as plain `Error` objects — class instances and
 * custom properties (including `code`) are lost — but `error.message` is
 * preserved.  `extractAtlasApiErrorCode` uses that invariant to recover the
 * discriminant on the client, so the run-start failure can be classified
 * without leaking the raw HTTP status or response body to the UI.
 */
export const ATLAS_API_ERROR_CODE = {
  /** The actor has exhausted their plan's research-run allowance (HTTP 429). */
  AT_LIMIT: "ATLAS_API_AT_LIMIT",
  /** Atlas itself failed and a retry may succeed (HTTP 5xx). */
  TEMPORARILY_UNAVAILABLE: "ATLAS_API_TEMPORARILY_UNAVAILABLE",
  /** Any other non-ok response that the UI should treat as a generic failure. */
  REQUEST_FAILED: "ATLAS_API_REQUEST_FAILED",
} as const;

export type AtlasApiErrorCode = (typeof ATLAS_API_ERROR_CODE)[keyof typeof ATLAS_API_ERROR_CODE];

/**
 * Error raised when an Atlas API request returns a non-ok response.  The
 * `code` is the stable, classifiable signal; it is also passed to `super`
 * so it survives as `error.message` across the server-function boundary.
 */
export class AtlasApiError extends Error {
  constructor(public readonly code: AtlasApiErrorCode) {
    super(code);
    this.name = "AtlasApiError";
  }
}

/**
 * Maps an HTTP status code from the Atlas API to a stable error code,
 * never exposing the raw status to the caller.
 *
 * Parameters
 * ----------
 * status : number
 *     The HTTP status of the non-ok response.
 *
 * Returns
 * -------
 * AtlasApiErrorCode
 *     `AT_LIMIT` for 429, `TEMPORARILY_UNAVAILABLE` for any 5xx, and
 *     `REQUEST_FAILED` for every other non-ok status.
 */
export function classifyAtlasApiStatus(status: number): AtlasApiErrorCode {
  if (status === 429) {
    return ATLAS_API_ERROR_CODE.AT_LIMIT;
  }
  if (status >= 500) {
    return ATLAS_API_ERROR_CODE.TEMPORARILY_UNAVAILABLE;
  }
  return ATLAS_API_ERROR_CODE.REQUEST_FAILED;
}

/**
 * Recovers an `AtlasApiErrorCode` from an error after it has crossed the
 * server/client boundary.  Returns `null` for any error that was not an
 * `AtlasApiError` on the server (e.g., an unexpected programming error),
 * so callers fall back to safe generic copy.
 */
export function extractAtlasApiErrorCode(error: unknown): AtlasApiErrorCode | null {
  if (!(error instanceof Error)) {
    return null;
  }
  const message = error.message;
  return (Object.values(ATLAS_API_ERROR_CODE) as string[]).includes(message)
    ? (message as AtlasApiErrorCode)
    : null;
}

/**
 * Safe, user-appropriate copy for each non-at-limit discovery error class.
 * The at-limit case is handled by an in-the-moment upgrade affordance rather
 * than an inline message, so it is intentionally absent here.
 */
export const ATLAS_API_ERROR_MESSAGES: Record<
  typeof ATLAS_API_ERROR_CODE.TEMPORARILY_UNAVAILABLE | typeof ATLAS_API_ERROR_CODE.REQUEST_FAILED,
  string
> = {
  [ATLAS_API_ERROR_CODE.TEMPORARILY_UNAVAILABLE]:
    "Atlas is temporarily unavailable. Try again in a moment.",
  [ATLAS_API_ERROR_CODE.REQUEST_FAILED]: "Could not start the run. Check the fields and try again.",
};

/**
 * Resolves the safe inline message to show for a run-start failure, or `null`
 * when the failure is the at-limit case (handled by the upgrade affordance).
 * Unknown / unclassified errors fall back to the generic request-failed copy.
 *
 * Parameters
 * ----------
 * error : unknown
 *     The error surfaced by the start-discovery mutation.
 *
 * Returns
 * -------
 * string | null
 *     The safe message to display inline, or `null` to defer to the
 *     at-limit upgrade affordance.
 */
export function resolveStartRunErrorMessage(error: unknown): string | null {
  const code = extractAtlasApiErrorCode(error);
  if (code === ATLAS_API_ERROR_CODE.AT_LIMIT) {
    return null;
  }
  if (code === ATLAS_API_ERROR_CODE.TEMPORARILY_UNAVAILABLE) {
    return ATLAS_API_ERROR_MESSAGES[ATLAS_API_ERROR_CODE.TEMPORARILY_UNAVAILABLE];
  }
  return ATLAS_API_ERROR_MESSAGES[ATLAS_API_ERROR_CODE.REQUEST_FAILED];
}

/**
 * Whether a run-start failure was caused by the actor reaching their plan's
 * research-run limit, in which case the page surfaces an upgrade affordance.
 */
export function isAtLimitError(error: unknown): boolean {
  return extractAtlasApiErrorCode(error) === ATLAS_API_ERROR_CODE.AT_LIMIT;
}
