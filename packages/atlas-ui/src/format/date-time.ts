import { useMemo } from "react";
import { useHydrated } from "../hooks/use-hydrated";

/**
 * Locale for any render that must not depend on where it runs.
 *
 * `toLocaleString(undefined, ...)` resolves against whatever locale the running
 * process defaults to. On the server that is the container's locale; in the
 * browser it is the reader's. Pinning it makes the two agree.
 */
export const STABLE_LOCALE = "en-US";

/**
 * Time zone for any render that must not depend on where it runs.
 *
 * The server cannot know the reader's zone -- no HTTP header carries it -- so
 * anything rendered before the browser takes over commits to UTC.
 */
export const STABLE_TIME_ZONE = "UTC";

/** `7/26/2026` -- what a bare `toLocaleDateString()` produces. */
export const NUMERIC_DATE: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "numeric",
  year: "numeric",
};

/** `7/26/2026, 2:30:20 PM` -- what a bare `toLocaleString()` produces. */
export const NUMERIC_DATE_TIME: Intl.DateTimeFormatOptions = {
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  month: "numeric",
  second: "2-digit",
  year: "numeric",
};

/** `Jul 26, 2026`. */
export const MEDIUM_DATE: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
};

/** `Jul 26, 2026, 2:30 PM`. */
export const MEDIUM_DATE_TIME: Intl.DateTimeFormatOptions = {
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  month: "short",
  year: "numeric",
};

/** `Jul 2026` -- for facts only precise to the month. */
export const MONTH_YEAR: Intl.DateTimeFormatOptions = {
  month: "short",
  year: "numeric",
};

/** Anything the platform `Date` constructor accepts as a single argument. */
export type DateTimeValue = Date | number | string;

/**
 * Formats an instant for display. Callers always pass explicit field options so
 * the output never depends on a runtime default.
 */
export type DateTimeFormatter = (
  value: DateTimeValue,
  options: Intl.DateTimeFormatOptions,
) => string;

/**
 * Normalises the accepted input shapes to a `Date`.
 *
 * @param value - An instant as a `Date`, epoch milliseconds, or a parseable string.
 * @returns The corresponding `Date`, which may be an Invalid Date.
 */
function toDate(value: DateTimeValue): Date {
  return value instanceof Date ? value : new Date(value);
}

/**
 * Builds a formatter for one side of the hydration boundary.
 *
 * @param hydrated - `false` for the server render and the first browser render,
 *   `true` once the browser has taken over.
 * @returns A formatter pinned to UTC/`en-US` before hydration and to the
 *   reader's own clock and locale after it.
 */
export function createDateTimeFormatter(hydrated: boolean): DateTimeFormatter {
  return (value, options) => {
    const date = toDate(value);
    if (hydrated) {
      return date.toLocaleString(undefined, options);
    }
    return date.toLocaleString(STABLE_LOCALE, {
      ...options,
      timeZone: STABLE_TIME_ZONE,
    });
  };
}

/**
 * Formatter that never moves, for the two cases the reader's clock is wrong for:
 *
 * 1. Code that renders outside React -- data mappers, exports, anything that
 *    cannot call a hook and so can never learn the reader's zone.
 * 2. Date-only facts. A bare `YYYY-MM-DD` carries no clock, so shifting it into
 *    the reader's zone would render "founded 2026-07-26" as "Jul 25" for
 *    everyone behind UTC. Anchor those at `Date.UTC(...)` and format them here.
 *
 * For real instants inside a component, reach for {@link useDateTimeFormatter}
 * instead so the reader sees their own clock.
 */
export const formatStableDateTime: DateTimeFormatter =
  createDateTimeFormatter(false);

/**
 * Formats instants without breaking hydration.
 *
 * A timestamp only means something in the reader's own time zone, and the
 * server has no way to learn it. Formatting straight from `toLocaleString`
 * therefore renders one string on the server and a different one in the
 * browser: React silently rewrites the text and the reader watches the time
 * change under them. This hook makes the handover deliberate -- the server and
 * the first browser render agree on UTC, then the browser re-renders in the
 * reader's own clock.
 *
 * @returns A formatter that is stable across the hydration boundary.
 */
export function useDateTimeFormatter(): DateTimeFormatter {
  const hydrated = useHydrated();
  return useMemo(() => createDateTimeFormatter(hydrated), [hydrated]);
}

/**
 * Formats a timestamp that may be absent, for surfaces that render nothing at
 * all rather than a placeholder.
 *
 * @param format - Formatter from {@link useDateTimeFormatter}.
 * @param value - The instant to render, if the record carries one.
 * @param options - Field options, usually one of the presets in this module.
 * @returns The formatted instant, or `null` when there is nothing real to show.
 */
export function formatDateTimeOrNull(
  format: DateTimeFormatter,
  value: DateTimeValue | null | undefined,
  options: Intl.DateTimeFormatOptions,
): string | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return format(date, options);
}

/**
 * Formats a timestamp, echoing the source text back when it is not a real
 * instant -- for surfaces that would rather show the raw upstream value than
 * drop the fact entirely.
 *
 * @param format - Formatter from {@link useDateTimeFormatter}.
 * @param value - The instant to render, as it arrived from the source.
 * @param options - Field options, usually one of the presets in this module.
 * @returns The formatted instant, or `value` unchanged when it cannot be parsed.
 */
export function formatDateTimeOrInput(
  format: DateTimeFormatter,
  value: string,
  options: Intl.DateTimeFormatOptions,
): string {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return format(date, options);
}
