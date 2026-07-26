// @vitest-environment jsdom

import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { createEntryFixture } from "@/../tests/fixtures/catalog/entries";
import { resetRouterMocks } from "@/../tests/helpers/router-harness";

const mocks = vi.hoisted(() => ({
  useEntries: vi.fn(),
  useTaxonomy: vi.fn(),
}));

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@headlessui/react", () => ({
  Popover: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  PopoverButton: ({ children, className }: { children: ReactNode; className?: string }) => (
    <button type="button" className={className}>
      {children}
    </button>
  ),
  PopoverPanel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/domains/catalog/components/browse/us-map-surface", () => {
  throw new Error("Browse list rendering should not import the US map surface");
});

vi.mock("@/domains/catalog/components/entries/entry-list", () => ({
  EntryList: ({ total }: { total?: number }) => <div>Entry list total: {total ?? 0}</div>,
}));

vi.mock("@rebuildingamerica/atlas-catalog/hooks/use-entries", () => ({
  useEntries: mocks.useEntries,
}));

vi.mock("@rebuildingamerica/atlas-catalog/hooks/use-taxonomy", () => ({
  useTaxonomy: mocks.useTaxonomy,
}));

describe("BrowsePage route splitting", () => {
  beforeEach(() => {
    resetRouterMocks();
    mocks.useTaxonomy.mockReturnValue({ data: {} });
    mocks.useEntries.mockReturnValue({
      data: {
        data: [createEntryFixture({ id: "entry_1", type: "organization" })],
        facets: {
          cities: [],
          issue_areas: [],
          regions: [],
          source_patterns: [],
          source_types: [],
          states: [],
        },
        pagination: {
          has_more: false,
          limit: 20,
          offset: 0,
          total: 1,
        },
      },
      error: null,
      isLoading: false,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders browse without evaluating the map library path", async () => {
    const { BrowsePage } = await import("@/domains/catalog/components/browse/browse-page");

    render(<BrowsePage search={{ query: "housing", view: "list" }} />);

    expect(screen.getByText("Entry list total: 1")).not.toBeNull();
  });
});
