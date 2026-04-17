// @vitest-environment jsdom

import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  useEntry: vi.fn(),
  useTaxonomy: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="#">{children}</a>,
}));

vi.mock("@/platform/layout/page-layout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/domains/catalog/hooks/use-entries", () => ({
  useEntries: vi.fn(() => ({ data: [], isLoading: false })),
  useEntry: mocks.useEntry,
}));

vi.mock("@/domains/catalog/hooks/use-taxonomy", () => ({
  useTaxonomy: mocks.useTaxonomy,
}));

vi.mock("@/domains/catalog/components/entries/entry-detail", () => ({
  EntryDetail: ({ issueAreaLabels }: { issueAreaLabels: Record<string, string> }) => (
    <div>{issueAreaLabels.housing_affordability}</div>
  ),
}));

afterEach(() => {
  cleanup();
});

describe("EntryPage", () => {
  beforeEach(() => {
    mocks.useEntry.mockReset();
    mocks.useTaxonomy.mockReset();
    mocks.useEntry.mockReturnValue({
      data: { id: "entry_123" },
      error: null,
      isLoading: false,
    });
    mocks.useTaxonomy.mockReturnValue({
      data: {
        Housing: [{ name: "Housing", slug: "housing_affordability" }],
      },
    });
  });

  it("renders entry details with taxonomy-derived issue labels", async () => {
    const { EntryPage } = await import("@/domains/catalog/pages/entry-page");

    render(<EntryPage entryId="entry_123" />);

    expect(mocks.useEntry).toHaveBeenCalledWith("entry_123");
    expect(screen.getByText("Back to the Atlas")).not.toBeNull();
    expect(screen.getByText("Housing")).not.toBeNull();
  });

  it("renders without taxonomy labels when the taxonomy query is empty", async () => {
    mocks.useTaxonomy.mockReturnValue({
      data: undefined,
    });
    const { EntryPage } = await import("@/domains/catalog/pages/entry-page");

    render(<EntryPage entryId="entry_123" />);

    expect(screen.queryByText("Housing")).toBeNull();
  });
});
