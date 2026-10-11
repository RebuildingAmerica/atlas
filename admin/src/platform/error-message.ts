/**
 * The sentence an operator reads when something fails. The platform API's own
 * explanation is shown as written, because it says exactly what happened, such
 * as a decision that was saved but whose email was not sent.
 *
 * @param error - What the query or mutation threw.
 * @param fallback - What to say when the error carries no message.
 */
export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
