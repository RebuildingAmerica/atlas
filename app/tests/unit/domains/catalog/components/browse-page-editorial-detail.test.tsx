// @vitest-environment jsdom

import "./browse-page-test-setup";

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createEntryFixture } from "@/../tests/fixtures/catalog/entries";
import { BrowsePage } from "@/domains/catalog/components/browse/browse-page";
import { getNavigateCalls, mocks } from "./browse-page-test-setup";

describe("BrowsePage editorial shelves", () => {
  it("counts a lone actor and its single linked source in the singular", () => {
    mocks.useEntries.mockReturnValue({
      data: {
        data: [
          createEntryFixture({
            city: "Jackson",
            description: "Runs a tenant hotline.",
            id: "solo",
            issue_areas: ["housing_affordability"],
            latest_source_date: "2026-03-01",
            name: "Jackson Tenant Union",
            source_count: 1,
            state: "MS",
            type: "organization",
          }),
        ],
        facets: {
          cities: [],
          entity_types: [],
          issue_areas: [{ count: 3, value: "housing_affordability" }],
          regions: [],
          source_patterns: [],
          source_types: [],
          states: [],
        },
        pagination: { has_more: false, limit: 20, offset: 0, total: 1 },
      },
      error: null,
      isLoading: false,
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
          view: "list",
        }}
      />,
    );

    const section = screen.getByRole("region", { name: "Organizations" });
    expect(within(section).getByText("1 linked source")).toBeInTheDocument();
    expect(within(section).getByText("Jackson, MS")).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Housing Affordability 1 person or group 1 linked source Latest source Mar 1, 2026",
      }),
    ).toBeInTheDocument();
  });

  it("leaves the place line off a record with no location", () => {
    mocks.useEntries.mockReturnValue({
      data: {
        data: [
          createEntryFixture({
            city: undefined,
            description: "Runs a tenant hotline.",
            id: "placeless",
            issue_areas: [],
            name: "Nowhere Coalition",
            region: undefined,
            state: undefined,
            type: "organization",
          }),
        ],
        facets: {
          cities: [],
          entity_types: [],
          issue_areas: [],
          regions: [],
          source_patterns: [],
          source_types: [],
          states: [],
        },
        pagination: { has_more: false, limit: 20, offset: 0, total: 1 },
      },
      error: null,
      isLoading: false,
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
          view: "list",
        }}
      />,
    );

    const section = screen.getByRole("region", { name: "Organizations" });
    expect(within(section).getByRole("link", { name: "Nowhere Coalition" })).toBeInTheDocument();
    expect(within(section).getByText("3 linked sources")).toBeInTheDocument();
    expect(within(section).queryByText("Jackson, MS")).not.toBeInTheDocument();
  });

  it("says plainly that nothing is listed when the catalog comes back empty", () => {
    mocks.useEntries.mockReturnValue({
      data: {
        data: [],
        facets: {
          cities: [],
          entity_types: [],
          issue_areas: [],
          regions: [],
          source_patterns: [],
          source_types: [],
          states: [],
        },
        pagination: { has_more: false, limit: 20, offset: 0, total: 0 },
      },
      error: null,
      isLoading: false,
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
          view: "list",
        }}
      />,
    );

    expect(screen.getByText("No people or groups listed.")).toBeInTheDocument();
  });

  it("names the place a reader has narrowed to in the related shelves", () => {
    mocks.useEntries.mockReturnValue({
      data: {
        data: [createEntryFixture({ id: "entry_123", issue_areas: ["housing_affordability"] })],
        facets: {
          cities: [],
          entity_types: [],
          issue_areas: [{ count: 3, value: "housing_affordability" }],
          regions: [],
          source_patterns: [],
          source_types: [],
          states: [{ count: 3, value: "MO" }],
        },
        pagination: { has_more: false, limit: 20, offset: 0, total: 1 },
      },
      error: null,
      isLoading: false,
    });

    render(
      <BrowsePage
        search={{
          entry_types: undefined,
          issue_areas: undefined,
          offset: undefined,
          query: undefined,
          source_types: undefined,
          states: "MO",
          view: "list",
        }}
      />,
    );

    expect(screen.getByText("Issues in Missouri")).toBeInTheDocument();
    expect(screen.getByText("Places in Missouri")).toBeInTheDocument();
  });

  it("falls back to the shelf issues for quick filters when the taxonomy is empty", () => {
    mocks.useTaxonomy.mockReturnValue({ data: {} });
    mocks.useEntries.mockReturnValue({
      data: {
        data: [
          createEntryFixture({
            id: "a",
            issue_areas: ["housing_affordability"],
            name: "Alpha Coalition",
            type: "organization",
          }),
          createEntryFixture({
            id: "b",
            issue_areas: ["housing_affordability"],
            name: "Beta Coalition",
            type: "organization",
          }),
        ],
        facets: {
          cities: [],
          entity_types: [],
          issue_areas: [{ count: 3, value: "housing_affordability" }],
          regions: [],
          source_patterns: [],
          source_types: [],
          states: [],
        },
        pagination: { has_more: false, limit: 20, offset: 0, total: 2 },
      },
      error: null,
      isLoading: false,
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
          view: "list",
        }}
      />,
    );

    // Two records of one type share a row, so the shelf lays out in columns.
    const section = screen.getByRole("region", { name: "Organizations" });
    expect(section.querySelector(".lg\\:grid-cols-2")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Filter/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Issues/ }));
    expect(screen.getByRole("button", { name: "Housing Affordability" })).toBeInTheDocument();
  });
});

describe("BrowsePage result paging", () => {
  it("steps forward and back through the result pages", () => {
    mocks.useEntries.mockReturnValue({
      data: {
        data: [createEntryFixture({ id: "entry_123" })],
        facets: {
          cities: [],
          entity_types: [],
          issue_areas: [],
          regions: [],
          source_patterns: [],
          source_types: [],
          states: [],
        },
        pagination: { has_more: true, limit: 20, offset: 20, total: 60 },
      },
      error: null,
      isLoading: false,
    });

    render(
      <BrowsePage
        search={{
          entry_types: undefined,
          issue_areas: undefined,
          offset: 20,
          query: "tenants",
          source_types: undefined,
          states: undefined,
          view: "list",
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));

    const offsets = getNavigateCalls()
      .map((options) =>
        typeof options.search === "function" ? options.search({}) : options.search,
      )
      .filter((search) => search && "offset" in search)
      .map((search) => search?.offset);

    expect(offsets).toContain(40);
    expect(offsets).toContain(0);
  });
});

describe("BrowsePage active search chips", () => {
  it("lets a reader drop the search text they typed", () => {
    render(
      <BrowsePage
        search={{
          entry_types: undefined,
          issue_areas: undefined,
          offset: undefined,
          query: "tenants",
          source_types: undefined,
          states: undefined,
          view: "list",
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Remove tenants/ }));

    const searchUpdate = getNavigateCalls()
      .map((options) =>
        typeof options.search === "function" ? options.search({}) : options.search,
      )
      .find((search) => search && "query" in search);

    expect(searchUpdate).toMatchObject({ offset: 0, query: undefined });
  });

  it("humanizes a source type the label table does not name", () => {
    render(
      <BrowsePage
        search={{
          entry_types: undefined,
          issue_areas: undefined,
          offset: undefined,
          query: undefined,
          source_types: "zine_archive",
          states: undefined,
          view: "list",
        }}
      />,
    );

    expect(screen.getByText("Zine Archive")).toBeInTheDocument();
  });
});
