import { act } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDateTimeFormatter,
  formatDateTimeOrInput,
  formatDateTimeOrNull,
  useDateTimeFormatter,
  MEDIUM_DATE,
  MEDIUM_DATE_TIME,
  MONTH_YEAR,
  NUMERIC_DATE,
  NUMERIC_DATE_TIME,
  STABLE_LOCALE,
  STABLE_TIME_ZONE,
} from "./date-time";

const INSTANT = "2026-07-26T14:30:20.000Z";

const DATE_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  month: "numeric",
  year: "numeric",
};

function Clock() {
  const formatDateTime = useDateTimeFormatter();
  return <span>{formatDateTime(INSTANT, DATE_TIME_OPTIONS)}</span>;
}

describe("date-time formatting", () => {
  beforeEach(() => {
    // Stand the reader's clock somewhere other than UTC so every "adopts the
    // reader's clock" assertion still says something on a CI box already in UTC.
    vi.stubEnv("TZ", "Asia/Tokyo");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    document.body.innerHTML = "";
  });

  it("pins the pre-hydration render to UTC and a fixed locale", () => {
    const format = createDateTimeFormatter(false);

    expect(format(INSTANT, DATE_TIME_OPTIONS)).toBe(
      new Intl.DateTimeFormat(STABLE_LOCALE, {
        ...DATE_TIME_OPTIONS,
        timeZone: STABLE_TIME_ZONE,
      }).format(new Date(INSTANT)),
    );
  });

  it("overrides a caller time zone before hydration so both sides of the boundary agree", () => {
    const format = createDateTimeFormatter(false);

    expect(
      format(INSTANT, {
        ...DATE_TIME_OPTIONS,
        timeZone: "America/Los_Angeles",
      }),
    ).toBe(format(INSTANT, DATE_TIME_OPTIONS));
  });

  it("formats in the reader's own clock once hydrated", () => {
    const format = createDateTimeFormatter(true);

    expect(format(INSTANT, DATE_TIME_OPTIONS)).toBe(
      new Date(INSTANT).toLocaleString(undefined, DATE_TIME_OPTIONS),
    );
    expect(format(INSTANT, DATE_TIME_OPTIONS)).not.toBe(
      createDateTimeFormatter(false)(INSTANT, DATE_TIME_OPTIONS),
    );
  });

  it("accepts Date, epoch milliseconds, and ISO strings alike", () => {
    const format = createDateTimeFormatter(false);
    const expected = format(INSTANT, DATE_TIME_OPTIONS);

    expect(format(new Date(INSTANT), DATE_TIME_OPTIONS)).toBe(expected);
    expect(format(Date.parse(INSTANT), DATE_TIME_OPTIONS)).toBe(expected);
  });

  it("hydrates without React rewriting the server text, then adopts the reader's clock", () => {
    const container = document.createElement("div");
    container.innerHTML = renderToString(<Clock />);
    document.body.append(container);

    expect(container.textContent).toBe(
      createDateTimeFormatter(false)(INSTANT, DATE_TIME_OPTIONS),
    );

    const recoverableErrors: string[] = [];
    let root: ReturnType<typeof hydrateRoot> | null = null;
    act(() => {
      root = hydrateRoot(container, <Clock />, {
        onRecoverableError: (error) => {
          recoverableErrors.push(String(error));
        },
      });
    });

    expect(recoverableErrors).toEqual([]);
    expect(container.textContent).toBe(
      createDateTimeFormatter(true)(INSTANT, DATE_TIME_OPTIONS),
    );

    act(() => {
      root?.unmount();
    });
  });

  it("reproduces the bare toLocale* defaults it replaces", () => {
    const format = createDateTimeFormatter(true);
    const date = new Date(INSTANT);

    expect(format(date, NUMERIC_DATE)).toBe(date.toLocaleDateString());
    expect(format(date, NUMERIC_DATE_TIME)).toBe(date.toLocaleString());
  });

  it("renders the medium and month presets", () => {
    const format = createDateTimeFormatter(false);

    expect(format(INSTANT, MEDIUM_DATE)).toBe("Jul 26, 2026");
    expect(format(INSTANT, MEDIUM_DATE_TIME)).toBe("Jul 26, 2026, 2:30 PM");
    expect(format(INSTANT, MONTH_YEAR)).toBe("Jul 2026");
  });

  it("drops absent and unparseable instants when the surface wants nothing", () => {
    const format = createDateTimeFormatter(false);

    expect(formatDateTimeOrNull(format, INSTANT, MEDIUM_DATE)).toBe(
      "Jul 26, 2026",
    );
    expect(formatDateTimeOrNull(format, new Date(INSTANT), MEDIUM_DATE)).toBe(
      "Jul 26, 2026",
    );
    expect(formatDateTimeOrNull(format, null, MEDIUM_DATE)).toBeNull();
    expect(formatDateTimeOrNull(format, undefined, MEDIUM_DATE)).toBeNull();
    expect(formatDateTimeOrNull(format, "", MEDIUM_DATE)).toBeNull();
    expect(formatDateTimeOrNull(format, "not-a-date", MEDIUM_DATE)).toBeNull();
  });

  it("echoes the source text when the surface would rather show it than nothing", () => {
    const format = createDateTimeFormatter(false);

    expect(formatDateTimeOrInput(format, INSTANT, MONTH_YEAR)).toBe("Jul 2026");
    expect(formatDateTimeOrInput(format, "not-a-date", MONTH_YEAR)).toBe(
      "not-a-date",
    );
  });
});
