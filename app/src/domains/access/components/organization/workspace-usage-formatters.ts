/**
 * Format a count for compact admin display.
 *
 * @param value - Numeric count from the usage summary.
 */
export function formatUsageCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

/**
 * Convert stored event keys into compact labels.
 *
 * @param eventType - Event type key from the usage ledger.
 */
export function formatUsageEventType(eventType: string): string {
  if (eventType === "api_call") {
    return "API call";
  }

  const spaced = eventType.replaceAll("_", " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
