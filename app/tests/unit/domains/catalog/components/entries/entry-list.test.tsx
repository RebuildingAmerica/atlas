// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { EntryList } from "@/domains/catalog/components/entries/entry-list";
import { createEntryFixture } from "../../../../../fixtures/catalog/entries";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

describe("EntryList result summary", () => {
  it("counts a single match in the singular", () => {
    render(<EntryList entries={[createEntryFixture()]} total={1} />);
    expect(screen.getByText("1 match")).toBeInTheDocument();
  });

  it("counts several matches in the plural", () => {
    render(<EntryList entries={[createEntryFixture()]} total={7} />);
    expect(screen.getByText("7 matches")).toBeInTheDocument();
  });
});

describe("EntryList empty state", () => {
  it("names the thing that is missing when the caller labels its own results", () => {
    render(<EntryList entries={[]} resultLabelPlural="organizations" />);
    expect(screen.getByText("No organizations listed.")).toBeInTheDocument();
    expect(screen.getByText("Start with a place, issue, person, or group.")).toBeInTheDocument();
  });

  it("says nothing matched when a labelled search came back empty", () => {
    render(<EntryList entries={[]} hasActiveSearch resultLabelPlural="organizations" />);
    expect(screen.getByText("No matching organizations.")).toBeInTheDocument();
    expect(
      screen.getByText("Try fewer filters, a broader place, or another issue."),
    ).toBeInTheDocument();
  });
});
