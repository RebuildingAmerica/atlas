import { isNotFound } from "@tanstack/react-router";

/** First wait before a public page asks the API again. */
export const PUBLIC_QUERY_RETRY_BASE_MS = 1_000;

/** Longest wait between attempts, so a recovered API shows up within half a minute. */
export const PUBLIC_QUERY_RETRY_CAP_MS = 30_000;

/**
 * Decides whether a public page's browser fetch should try again.
 *
 * A public page never shows a visitor a failure: the section keeps its
 * placeholder until the API answers. A missing record is an answer, so it
 * stops the retries and lets the page render not-found instead.
 *
 * @param _failureCount - Attempts so far. The count never ends the retries.
 * @param error - Why the last attempt failed.
 * @returns Whether to schedule another attempt.
 */
export function shouldRetryPublicQuery(_failureCount: number, error: unknown): boolean {
  return !isNotFound(error);
}

/**
 * Spaces out retries so a rate-limited API is not hammered by the pages it rejected.
 *
 * @param attempt - Zero-based index of the retry about to run.
 * @returns Milliseconds to wait before that retry.
 */
export function publicQueryRetryDelay(attempt: number): number {
  return Math.min(PUBLIC_QUERY_RETRY_BASE_MS * 2 ** attempt, PUBLIC_QUERY_RETRY_CAP_MS);
}

/** React Query options every public page's browser fetch shares. */
export const PUBLIC_QUERY_RETRY_OPTIONS = {
  refetchOnReconnect: true,
  retry: shouldRetryPublicQuery,
  retryDelay: publicQueryRetryDelay,
} as const;
