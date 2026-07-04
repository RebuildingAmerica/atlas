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

/**
 * Format a timestamp if it parses cleanly.
 *
 * @param value - ISO timestamp from the usage ledger.
 * @param options - Date-time display options.
 */
function formatUsageTimestamp(value: string, options: Intl.DateTimeFormatOptions): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat("en-US", options).format(date);
}

/**
 * Format event timestamps for compact audit-log rows.
 *
 * @param value - ISO timestamp recorded with the usage event.
 */
export function formatUsageAuditTimestamp(value: string): string | null {
  return formatUsageTimestamp(value, {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/**
 * Format dates for summary-level last-seen labels.
 *
 * @param value - ISO timestamp recorded with the latest integration event.
 */
export function formatUsageDate(value: string): string | null {
  return formatUsageTimestamp(value, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
