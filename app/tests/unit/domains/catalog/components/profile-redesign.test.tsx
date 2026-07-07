// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  FreshnessChip,
  formatFreshness,
} from "@/domains/catalog/components/profiles/detail/profile-detail-primitives";

describe("formatFreshness", () => {
  it("returns 'today' for same-day timestamps", () => {
    const now = new Date("2026-04-26T12:00:00Z");
    const result = formatFreshness("2026-04-26T08:00:00Z", now);
    expect(result.label).toBe("today");
    expect(result.status).toBe("fresh");
  });

  it("returns weeks-ago for ranges between 7 and 60 days", () => {
    const now = new Date("2026-04-26T00:00:00Z");
    const fortyDays = new Date("2026-03-17T00:00:00Z");
    const result = formatFreshness(fortyDays.toISOString(), now);
    expect(result.label).toMatch(/w ago/);
    expect(result.status).toBe("aging");
  });

  it("flags stale dates beyond 180 days", () => {
    const now = new Date("2026-04-26T00:00:00Z");
    const old = new Date("2024-01-01T00:00:00Z");
    const result = formatFreshness(old.toISOString(), now);
    expect(result.status).toBe("stale");
  });

  it("returns 'yesterday' for one-day-old timestamps", () => {
    const now = new Date("2026-04-26T12:00:00Z");
    const yesterday = new Date("2026-04-25T08:00:00Z");
    const result = formatFreshness(yesterday.toISOString(), now);
    expect(result.label).toBe("yesterday");
    expect(result.status).toBe("fresh");
  });

  it("returns days-ago for timestamps under a week", () => {
    const now = new Date("2026-04-26T12:00:00Z");
    const threeDays = new Date("2026-04-23T12:00:00Z");
    const result = formatFreshness(threeDays.toISOString(), now);
    expect(result.label).toBe("3d ago");
  });

  it("returns months-ago for timestamps in the months range", () => {
    const now = new Date("2026-04-26T12:00:00Z");
    const sixtyDays = new Date("2026-02-25T12:00:00Z");
    const result = formatFreshness(sixtyDays.toISOString(), now);
    expect(result.label).toMatch(/mo ago/);
  });

  it("returns years-ago for timestamps beyond 730 days", () => {
    const now = new Date("2026-04-26T12:00:00Z");
    const ancient = new Date("2020-01-01T00:00:00Z");
    const result = formatFreshness(ancient.toISOString(), now);
    expect(result.label).toMatch(/y\+ ago/);
  });
});

describe("FreshnessChip", () => {
  it("renders the formatted label", () => {
    render(<FreshnessChip isoDate={new Date().toISOString()} prefix="Last seen" />);
    expect(screen.getByText(/Last seen/)).toBeInTheDocument();
  });
});
