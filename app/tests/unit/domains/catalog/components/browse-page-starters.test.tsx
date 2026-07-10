// @vitest-environment jsdom

import "./browse-page-test-setup";

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createEntryFixture } from "@/../tests/fixtures/catalog/entries";
import { BrowsePage } from "@/domains/catalog/components/browse/browse-page";
import { getNavigateCalls, mocks } from "./browse-page-test-setup";

describe("BrowsePage editorial browsing", () => {
  it("uses default browse as a primitive catalog, not a map or homepage", () => {
    mocks.useEntries.mockReturnValue({
      data: {
        data: [
          createEntryFixture({
            id: "documented",
            name: "Kansas City Tenant Union",
            city: "Kansas City",
            issue_areas: ["housing_affordability"],
            latest_source_date: "2026-03-01",
            source_count: 9,
            state: "MO",
            type: "organization",
          }),
          createEntryFixture({
            id: "recent",
            name: "Maya Johnson",
            city: "Independence",
            issue_areas: ["housing_affordability"],
            latest_source_date: "2026-04-20",
            source_count: 3,
            state: "MO",
            type: "person",
          }),
        ],
        facets: {
          cities: [{ count: 6, value: "Kansas City" }],
          entity_types: [{ count: 8, value: "organization" }],
          issue_areas: [{ count: 12, value: "housing_affordability" }],
          regions: [{ count: 4, value: "Midwest" }],
          source_patterns: [{ count: 10, value: "press_release" }],
          source_types: [{ count: 7, value: "government_record" }],
          states: [{ count: 14, value: "MO" }],
        },
        pagination: {
          has_more: false,
          limit: 20,
          offset: 0,
          total: 2,
        },
      },
      error: null,
      isLoading: false,
    });

    render(
      <BrowsePage
        search={{
          issue_areas: undefined,
          offset: undefined,
          query: undefined,
          source_types: undefined,
          states: undefined,
          view: undefined,
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: "Browse Atlas" })).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Browse the civic field." }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        "Start with the places, issues, people, and records already visible in Atlas.",
      ),
    ).not.toBeInTheDocument();
    const issues = screen.getByRole("region", { name: "Issues" });
    const browseTools = screen.getByRole("region", { name: "Browse tools" });
    const organizations = screen.getByRole("region", { name: "Organizations" });

    expect(issues).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Places" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "People" })).toBeInTheDocument();
    expect(organizations).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Sources" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Evidence/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Filter/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(
      issues.compareDocumentPosition(browseTools) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      issues.compareDocumentPosition(organizations) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      within(issues).getByText(
        "Kansas City Tenant Union and 1 more are active in Kansas City, Missouri.",
      ),
    ).toBeInTheDocument();
    expect(within(issues).getByText("2 people and groups")).toBeInTheDocument();
    expect(within(issues).getByText("2 places")).toBeInTheDocument();
    expect(within(issues).getByText("12 linked sources")).toBeInTheDocument();
    expect(within(issues).getByText("Latest source Apr 20, 2026")).toBeInTheDocument();
    expect(within(issues).queryByText("12 records")).not.toBeInTheDocument();
    expect(
      within(issues).getByRole("button", {
        name: /Housing Affordability.*2 people and groups.*12 linked sources/,
      }),
    ).toBeInTheDocument();
    expect(
      within(issues).queryByRole("button", { name: "Housing Affordability 12 records" }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText("Kansas City Tenant Union").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Maya Johnson").length).toBeGreaterThan(0);
    expect(within(organizations).getByText("9 linked sources")).toBeInTheDocument();
    expect(within(organizations).queryByText("9 records")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Browse by" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "What to watch" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Ecosystem history" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Select Missouri" })).not.toBeInTheDocument();
    expect(screen.queryByText(/source signal/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/source pattern/i)).not.toBeInTheDocument();
  });

  it("turns editorial shelves into browse filters", () => {
    mocks.useEntries.mockReturnValue({
      data: {
        data: [createEntryFixture({ id: "entry_123" })],
        facets: {
          cities: [],
          entity_types: [],
          issue_areas: [],
          regions: [],
          source_patterns: [],
          source_types: [{ count: 6, value: "news_article" }],
          states: [
            { count: 10, value: "MO" },
            { count: 5, value: "CA" },
          ],
        },
        pagination: {
          has_more: false,
          limit: 20,
          offset: 0,
          total: 10,
        },
      },
      error: null,
      isLoading: false,
    });

    render(
      <BrowsePage
        search={{
          issue_areas: undefined,
          offset: undefined,
          query: undefined,
          source_types: undefined,
          states: undefined,
          view: undefined,
        }}
      />,
    );

    const placesSection = screen.getByRole("region", { name: "Places" });
    fireEvent.click(within(placesSection).getByRole("button", { name: "Missouri 10 records" }));

    fireEvent.click(screen.getByRole("button", { name: /Filter/ }));
    fireEvent.click(screen.getByRole("button", { name: /Evidence/ }));
    fireEvent.click(screen.getByRole("button", { name: /Local news/ }));

    const computedSearches = getNavigateCalls()
      .map((options) =>
        typeof options.search === "function" ? options.search({ view: "map" }) : options.search,
      )
      .filter(Boolean);

    expect(computedSearches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ offset: 0, states: "MO", view: "list" }),
        expect.objectContaining({ offset: 0, source_types: "news_article", view: "list" }),
      ]),
    );
  });

  it("personalizes index headings around the current browse place", () => {
    mocks.useEntries.mockReturnValue({
      data: {
        data: [createEntryFixture({ id: "entry_123", state: "MO" })],
        facets: {
          cities: [{ count: 4, value: "Kansas City" }],
          entity_types: [{ count: 5, value: "organization" }],
          issue_areas: [{ count: 9, value: "housing_affordability" }],
          regions: [],
          source_patterns: [],
          source_types: [{ count: 6, value: "government_record" }],
          states: [{ count: 10, value: "MO" }],
        },
        pagination: {
          has_more: false,
          limit: 20,
          offset: 0,
          total: 10,
        },
      },
      error: null,
      isLoading: false,
    });

    render(
      <BrowsePage
        search={{
          issue_areas: undefined,
          offset: undefined,
          query: undefined,
          source_types: undefined,
          states: "MO",
          view: undefined,
        }}
      />,
    );

    expect(screen.getByRole("region", { name: "Issues in Missouri" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Places in Missouri" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Search results" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Sources in Missouri" })).not.toBeInTheDocument();
  });
});
