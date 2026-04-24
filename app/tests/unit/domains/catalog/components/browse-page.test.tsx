// @vitest-environment jsdom

import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

interface BrowseSearchUpdate {
  offset?: number;
  query?: string;
  view?: string;
}

interface NavigateOptions {
  search?: BrowseSearchUpdate | ((current: BrowseSearchUpdate) => BrowseSearchUpdate);
}

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  useEntries: vi.fn(),
  useTaxonomy: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
}));

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

vi.mock("@/platform/layout/page-layout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/platform/ui/button", () => ({
  Button: ({
    children,
    disabled,
    onClick,
    type = "button",
  }: {
    children: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
    type?: "button" | "submit" | "reset";
  }) => (
    <button type={type} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock("@/domains/catalog/components/browse/us-map-surface", () => ({
  UsMapSurface: ({ onSelectState }: { onSelectState: (state: string) => void }) => (
    <button
      type="button"
      onClick={() => {
        onSelectState("MO");
      }}
    >
      Select Missouri
    </button>
  ),
}));

vi.mock("@/domains/catalog/components/entries/entry-list", () => ({
  EntryList: ({ total }: { total?: number }) => <div>Entry list total: {total ?? 0}</div>,
}));

vi.mock("@/domains/catalog/hooks/use-entries", () => ({
  useEntries: mocks.useEntries,
}));

vi.mock("@/domains/catalog/hooks/use-taxonomy", () => ({
  useTaxonomy: mocks.useTaxonomy,
}));

afterEach(() => {
  cleanup();
});

function getNavigateCalls(): NavigateOptions[] {
  return mocks.navigate.mock.calls.map(([options]) => options as NavigateOptions);
}

describe("BrowsePage", () => {
  beforeEach(() => {
    mocks.navigate.mockReset();
    mocks.useEntries.mockReset();
    mocks.useTaxonomy.mockReset();
    mocks.useTaxonomy.mockReturnValue({
      data: {
        Housing: [
          {
            description: "Housing policy",
            name: "Housing Affordability",
            slug: "housing_affordability",
          },
        ],
      },
    });
    mocks.useEntries.mockReturnValue({
      data: {
        data: [
          {
            id: "entry_123",
          },
        ],
        facets: {
          states: [
            { count: 10, value: "MO" },
            { count: 5, value: "CA" },
          ],
        },
        pagination: {
          has_more: true,
          limit: 20,
          offset: 0,
          total: 25,
        },
      },
      error: null,
      isLoading: false,
    });
  });

  it("renders map browse controls and issues navigate updates for search interactions", async () => {
    const { BrowsePage } = await import("@/domains/catalog/components/browse/browse-page");

    render(
      <BrowsePage
        search={{
          issue_areas: undefined,
          offset: undefined,
          query: "",
          source_types: undefined,
          states: undefined,
          view: "map",
        }}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Search place, issue, or name"), {
      target: { value: "housing" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.click(screen.getByRole("button", { name: "Grid" }));
    fireEvent.click(screen.getByRole("button", { name: "List" }));
    fireEvent.click(screen.getByRole("button", { name: "Map" }));
    fireEvent.click(screen.getByRole("button", { name: "Select Missouri" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    fireEvent.click(screen.getByRole("button", { name: "Housing Affordability" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByText("Entry list total: 25")).not.toBeNull();
    const computedSearches = getNavigateCalls()
      .map((options) =>
        typeof options.search === "function"
          ? options.search({ query: "old", view: "map" })
          : options.search,
      )
      .filter(Boolean);

    expect(computedSearches.length).toBeGreaterThan(0);
    expect(mocks.navigate).toHaveBeenCalled();
  });

  it("renders grid and list views with state summaries", async () => {
    const { BrowsePage } = await import("@/domains/catalog/components/browse/browse-page");
    const { rerender } = render(
      <BrowsePage
        search={{
          issue_areas: "housing_affordability",
          offset: undefined,
          query: "housing",
          source_types: undefined,
          states: "MO",
          view: "grid",
        }}
      />,
    );

    expect(screen.getByText("Missouri")).not.toBeNull();
    fireEvent.click(screen.getByText("Missouri"));

    rerender(
      <BrowsePage
        search={{
          issue_areas: "housing_affordability",
          offset: undefined,
          query: "housing",
          source_types: undefined,
          states: "MO",
          view: "list",
        }}
      />,
    );

    expect(screen.getByText("01")).not.toBeNull();
    expect(screen.getByText("MO")).not.toBeNull();
    fireEvent.click(screen.getByText("California"));
  });

  it("renders selected badges, previous pagination, and missing-taxonomy fallbacks", async () => {
    const { BrowsePage } = await import("@/domains/catalog/components/browse/browse-page");
    mocks.useTaxonomy.mockReturnValue({
      data: undefined,
    });
    mocks.useEntries.mockReturnValue({
      data: {
        data: [
          {
            id: "entry_123",
          },
        ],
        facets: {
          states: [
            { count: 10, value: "MO" },
            { count: 5, value: "CA" },
          ],
        },
        pagination: {
          has_more: true,
          limit: 20,
          offset: 20,
          total: 25,
        },
      },
      error: null,
      isLoading: false,
    });

    render(
      <BrowsePage
        search={{
          entry_types: "organization",
          issue_areas: "housing_affordability",
          offset: 20,
          query: "housing",
          source_types: "news_article",
          states: "MO",
          view: "list",
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    const latestHousingButton = screen
      .getAllByRole("button", { name: "Housing Affordability" })
      .at(-1);
    if (!latestHousingButton) {
      throw new TypeError("Expected a Housing Affordability filter button.");
    }

    fireEvent.click(latestHousingButton);
    screen.getAllByRole("button", { name: "Organizations" }).forEach((button) => {
      fireEvent.click(button);
    });
    screen.getAllByRole("button", { name: "Local news" }).forEach((button) => {
      fireEvent.click(button);
    });

    expect(screen.getAllByRole("button", { name: "Organizations" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Local news" }).length).toBeGreaterThan(0);
    expect(mocks.navigate).toHaveBeenCalled();
  });

  it("falls back cleanly when browse results have not loaded yet and empty searches are submitted", async () => {
    const { BrowsePage } = await import("@/domains/catalog/components/browse/browse-page");
    mocks.useEntries.mockReturnValue({
      data: undefined,
      error: null,
      isLoading: true,
    });

    render(
      <BrowsePage
        search={{
          entry_types: undefined,
          issue_areas: undefined,
          offset: undefined,
          query: undefined,
          source_types: undefined,
          states: undefined,
          view: "map",
        }}
      />,
    );

    expect(screen.getByText("United States")).not.toBeNull();
    expect(screen.getByText("0 entries")).not.toBeNull();
    expect(screen.getByText("Entry list total: 0")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    const searchUpdate = getNavigateCalls()
      .map((options) =>
        typeof options.search === "function" ? options.search({}) : options.search,
      )
      .find((search) => search && "offset" in search);

    expect(searchUpdate).toMatchObject({
      offset: 0,
      query: undefined,
    });
  });

  it("reuses the same browse engine for people directories without exposing type switching", async () => {
    const { BrowsePage } = await import("@/domains/catalog/components/browse/browse-page");

    render(
      <BrowsePage
        search={{
          entry_types: "organization",
          issue_areas: undefined,
          offset: undefined,
          query: "organizer",
          source_types: undefined,
          states: undefined,
          view: "map",
        }}
        page={{
          eyebrow: "Profiles",
          title: "People profiles",
          description: "Directory copy",
          lockedEntryTypes: ["person"],
          resultLabelPlural: "profiles",
          resultsHeading: "People",
          searchPlaceholder: "Search people, place, or issue",
          showEntryTypeFilter: false,
        }}
      />,
    );

    expect(screen.getByText("People profiles")).not.toBeNull();
    expect(screen.getByPlaceholderText("Search people, place, or issue")).not.toBeNull();
    expect(screen.queryByText("Types")).toBeNull();
    expect(mocks.useEntries).toHaveBeenCalledWith(
      expect.objectContaining({
        entry_types: ["person"],
        query: "organizer",
      }),
    );
  });

  it("humanizes unknown filters and unknown state codes in grid and list browse surfaces", async () => {
    const { BrowsePage } = await import("@/domains/catalog/components/browse/browse-page");
    mocks.useTaxonomy.mockReturnValue({
      data: {
        Housing: [],
      },
    });
    mocks.useEntries.mockReturnValue({
      data: {
        data: [
          {
            id: "entry_unknown",
          },
        ],
        facets: {
          states: [{ count: 3, value: "XX" }],
        },
        pagination: {
          has_more: false,
          limit: 20,
          offset: 0,
          total: 3,
        },
      },
      error: null,
      isLoading: false,
    });

    const { rerender } = render(
      <BrowsePage
        search={{
          entry_types: "mutual_aid",
          issue_areas: undefined,
          offset: undefined,
          query: undefined,
          source_types: "community_archive",
          states: "XX",
          view: "grid",
        }}
      />,
    );

    expect(screen.getAllByText("XX").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "XX 3 matching records" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Mutual Aid" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Community Archive" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "XX 3 matching records" }));

    rerender(
      <BrowsePage
        search={{
          entry_types: "mutual_aid",
          issue_areas: undefined,
          offset: undefined,
          query: undefined,
          source_types: "community_archive",
          states: "XX",
          view: "list",
        }}
      />,
    );

    expect(screen.getAllByText("XX").length).toBeGreaterThan(0);
    const latestUnknownState = screen.getAllByText("XX").at(-1);
    if (!latestUnknownState) {
      throw new TypeError("Expected an XX state label in the list view.");
    }

    fireEvent.click(latestUnknownState);
    expect(mocks.navigate).toHaveBeenCalled();
  });
});
