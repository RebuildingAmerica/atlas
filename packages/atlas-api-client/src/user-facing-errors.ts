import { AtlasApiError } from "./orval/fetcher";

/**
 * An error whose message was written for the visitor to read.
 *
 * Every other error is treated as internal, because its message can name an
 * environment variable, a database table, or a library's exception. Throw this
 * only with a sentence you would put on the page yourself.
 */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}

// The API writes its 400, 409, 410 and 422 `detail` strings as sentences for
// the person filling in the form, such as "This profile is already verified by
// another user." A 429 or 5xx body comes from a rate limiter or a crash, and a
// 401, 403 or 404 detail describes Atlas's records rather than what the visitor
// can fix.
const API_DETAIL_STATUSES = new Set([400, 409, 410, 422]);

// A longer or multi-line detail is a stack trace or an HTML error page rather
// than a sentence.
const MAX_API_DETAIL_LENGTH = 300;

interface ApiErrorBody {
  detail?: unknown;
}

function parseApiErrorBody(body: string): ApiErrorBody | null {
  try {
    const parsed: unknown = JSON.parse(body);
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

function isSentence(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_API_DETAIL_LENGTH &&
    !value.includes("\n") &&
    !value.includes("<")
  );
}

/**
 * Returns the API's own explanation of a rejected request when the API wrote
 * it for the visitor.
 *
 * @param error - Anything a request or mutation rejected with.
 * @returns The API's `detail` sentence for a 400, 409, 410 or 422 response,
 *   or `null` for every other error, including FastAPI's field-error arrays.
 */
export function userFacingApiDetail(error: unknown): string | null {
  if (!(error instanceof AtlasApiError) || !API_DETAIL_STATUSES.has(error.status)) {
    return null;
  }
  const detail = parseApiErrorBody(error.body)?.detail;
  if (typeof detail !== "string") {
    return null;
  }
  const trimmed = detail.trim();
  return isSentence(trimmed) ? trimmed : null;
}

/**
 * Chooses what a visitor reads when something they asked for failed.
 *
 * A server function delivers a plain `Error` to the browser with only its
 * message kept. The app registers serialization adapters so `UserFacingError`
 * and `AtlasApiError` keep their class across that boundary, and any other
 * error gets the fallback.
 *
 * @param error - Anything a request, mutation, or server function rejected with.
 * @param fallback - The sentence for a failure whose message is internal.
 * @returns A sentence that never contains a response body, a status code, or
 *   an exception message.
 */
export function userFacingErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof UserFacingError) {
    return error.message;
  }
  if (error instanceof AtlasApiError) {
    return userFacingApiDetail(error) ?? error.message;
  }
  return fallback;
}
