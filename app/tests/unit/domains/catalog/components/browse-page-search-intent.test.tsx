// @vitest-environment jsdom

import "./browse-page-test-setup";

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BrowsePage } from "@/domains/catalog/components/browse/browse-page";
import { getNavigateCalls, mocks } from "./browse-page-test-setup";

describe("BrowsePage search intent", () => {
  it("shows active place-plus-issue search as results without focus brief panels", () => {
    mocks.useEntries.mockReturnValue({
      data: {
        data: [{ id: "entry_123" }],
        facets: {
          cities: [],
          entity_types: [{ count: 15, value: "organization" }],
          issue_areas: [{ count: 12, value: "housing_affordability" }],
          regions: [],
          source_patterns: [{ count: 14, value: "multi_source" }],
          source_types: [{ count: 9, value: "news_article" }],
          states: [{ count: 10, value: "MO" }],
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

    expect(screen.getByDisplayValue("tenant union")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Filter/ })).toBeInTheDocument();
    expect(screen.getAllByText("Missouri").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Housing Affordability").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Organizations").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Local news").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Evidence/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Filter/ }));
    expect(screen.getByRole("button", { name: /Evidence/ })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Search results" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Issues in Missouri + 1 more" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Places in Missouri + 1 more" })).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Sources in Missouri + 1 more" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Place brief")).not.toBeInTheDocument();
    expect(screen.queryByText("Issue brief")).not.toBeInTheDocument();
    expect(screen.queryByText(/source signal/i)).not.toBeInTheDocument();
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
      view: "list",
    });
  });

  it("keeps legacy source-pattern URL state removable without featuring source-pattern copy", () => {
    render(
      <BrowsePage
        search={{
          issue_areas: undefined,
          offset: undefined,
          query: undefined,
          source_patterns: "multi_source",
          source_types: undefined,
          states: undefined,
          view: "list",
        }}
      />,
    );

    expect(screen.getByRole("region", { name: "Search results" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Multi Source" })).toBeInTheDocument();
    expect(screen.queryByText(/source pattern/i)).not.toBeInTheDocument();
  });
});
