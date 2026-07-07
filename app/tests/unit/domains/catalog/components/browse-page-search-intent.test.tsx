// @vitest-environment jsdom

import "./browse-page-test-setup";

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BrowsePage } from "@/domains/catalog/components/browse/browse-page";
import { getNavigateCalls, mocks } from "./browse-page-test-setup";

describe("BrowsePage search intent", () => {
  it("summarizes the active place-plus-issue search without duplicating focus panels", () => {
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
          source_patterns: [
            { count: 14, value: "multi_source" },
            { count: 6, value: "single_source" },
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

    render(
      <BrowsePage
        search={{
          entry_types: "organization",
          issue_areas: "housing_affordability",
          offset: undefined,
          query: "tenant union",
          source_types: "news_article",
          states: "MO",
          view: "map",
        }}
      />,
    );

    expect(screen.queryByText("Research focus")).toBeNull();
    expect(screen.getByDisplayValue("tenant union")).not.toBeNull();
    expect(screen.getByText("Filters")).not.toBeNull();
    expect(screen.getAllByText("Missouri").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Housing Affordability").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Organizations").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Local news").length).toBeGreaterThan(0);
    expect(screen.getByText("Place brief")).not.toBeNull();
    expect(screen.getByText("Missouri housing ecosystem")).not.toBeNull();
    expect(screen.getAllByText("25 people or groups with sources.").length).toBeGreaterThan(0);
    expect(screen.getByText("Strongest signal: Multi-source confirmation")).not.toBeNull();
  });

  it("extracts source and actor intent from plain-language search into removable chips", () => {
    render(
      <BrowsePage
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

    fireEvent.change(screen.getByPlaceholderText("Try housing in Detroit"), {
      target: { value: "organizations in Missouri from local news" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    const searchUpdate = getNavigateCalls()
      .map((options) =>
        typeof options.search === "function" ? options.search({}) : options.search,
      )
      .find((nextSearch) => nextSearch?.states === "MO");

    expect(searchUpdate).toMatchObject({
      entry_types: "organization",
      offset: 0,
      query: undefined,
      source_types: "news_article",
      states: "MO",
    });
  });

  it("summarizes issue-level actors, sources, and gaps from filtered results", () => {
    mocks.useEntries.mockReturnValue({
      data: {
        data: [{ id: "entry_123" }],
        facets: {
          states: [
            { count: 10, value: "MO" },
            { count: 5, value: "CA" },
          ],
          source_patterns: [
            { count: 2, value: "multi_source" },
            { count: 9, value: "single_source" },
          ],
        },
        pagination: {
          has_more: false,
          limit: 20,
          offset: 0,
          total: 11,
        },
      },
      error: null,
      isLoading: false,
    });

    render(
      <BrowsePage
        search={{
          issue_areas: "housing_affordability",
          offset: undefined,
          query: undefined,
          source_types: undefined,
          states: undefined,
          view: "map",
        }}
      />,
    );

    expect(screen.getByText("Issue brief")).not.toBeNull();
    expect(screen.getByText("Housing Affordability landscape")).not.toBeNull();
    expect(screen.getByText("11 people or groups with sources.")).not.toBeNull();
    expect(screen.getByText("Source signal: Single-source leads")).not.toBeNull();
    expect(screen.getByText("Gap: build more multi-source confirmation.")).not.toBeNull();
  });
});
