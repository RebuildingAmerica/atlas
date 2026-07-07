// @vitest-environment jsdom

import "./browse-page-test-setup";

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createEntryFixture } from "@/../tests/fixtures/catalog/entries";
import { BrowsePage } from "@/domains/catalog/components/browse/browse-page";
import { getNavigateCalls, mocks } from "./browse-page-test-setup";

describe("BrowsePage results", () => {
  it("hydrates browse results from server-loaded initial entries", () => {
    const initialEntries = {
      data: [createEntryFixture({ id: "entry_initial", state: "MO" })],
      facets: {
        cities: [],
        entity_types: [],
        issue_areas: [],
        regions: [],
        source_patterns: [],
        source_types: [],
        states: [{ count: 7, value: "MO" }],
      },
      pagination: {
        has_more: false,
        limit: 20,
        offset: 0,
        total: 7,
      },
    };

    render(
      <BrowsePage
        initialEntries={initialEntries}
        search={{
          issue_areas: "housing_affordability",
          offset: undefined,
          query: "housing",
          source_types: undefined,
          states: "MO",
          view: "map",
        }}
      />,
    );

    expect(mocks.useEntries).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_areas: ["housing_affordability"],
        limit: 20,
        query: "housing",
        states: ["MO"],
      }),
      { initialData: initialEntries },
    );
  });

  it("shows an in-page results error when the route could not seed entries", () => {
    render(
      <BrowsePage
        initialEntriesLoadFailed
        search={{
          issue_areas: undefined,
          offset: undefined,
          query: undefined,
          source_types: undefined,
          states: undefined,
          view: "list",
        }}
      />,
    );

    expect(mocks.useEntries).toHaveBeenCalledWith(expect.objectContaining({ limit: 20 }), {
      enabled: false,
      retry: false,
    });
    expect(screen.getByRole("alert").textContent).toBe("Results could not load.");
  });

  it("converts place-plus-issue search phrases into browse filters", () => {
    render(
      <BrowsePage
        search={{
          issue_areas: undefined,
          offset: undefined,
          query: undefined,
          source_types: undefined,
          states: undefined,
          view: "map",
        }}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Try housing in Detroit"), {
      target: { value: "housing in Missouri" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    const searchUpdate = getNavigateCalls()
      .map((options) =>
        typeof options.search === "function" ? options.search({}) : options.search,
      )
      .find((nextSearch) => nextSearch?.states === "MO");

    expect(searchUpdate).toMatchObject({
      issue_areas: "housing_affordability",
      offset: 0,
      query: undefined,
      states: "MO",
    });
  });

  it("renders selected badges, previous pagination, and missing-taxonomy fallbacks", () => {
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
      .getAllByRole("button", { name: "Remove Housing Affordability" })
      .at(-1);
    if (!latestHousingButton) {
      throw new TypeError("Expected a Housing Affordability filter button.");
    }

    fireEvent.click(latestHousingButton);
    screen.getAllByRole("button", { name: "Remove Organizations" }).forEach((button) => {
      fireEvent.click(button);
    });
    screen.getAllByRole("button", { name: "Remove Local news" }).forEach((button) => {
      fireEvent.click(button);
    });

    expect(screen.getAllByRole("button", { name: "Remove Organizations" }).length).toBeGreaterThan(
      0,
    );
    expect(screen.getAllByRole("button", { name: "Remove Local news" }).length).toBeGreaterThan(0);
    expect(mocks.navigate).toHaveBeenCalled();
  });

  it("falls back cleanly when browse results have not loaded yet and empty searches are submitted", () => {
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
    expect(screen.getByText("0 matches")).not.toBeNull();
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

  it("reuses the same browse engine for people directories without exposing type switching", () => {
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
      { retry: false },
    );
  });

  it("humanizes unknown filters and unknown state codes in grid and list browse surfaces", () => {
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
    expect(screen.getAllByRole("button", { name: "Remove Mutual Aid" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /Community archive/i }).length).toBeGreaterThan(0);
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
    fireEvent.click(screen.getByRole("button", { name: "Remove XX" }));
    expect(mocks.navigate).toHaveBeenCalled();
  });
});
