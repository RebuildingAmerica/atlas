// @vitest-environment jsdom

import "./browse-page-test-setup";

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BrowsePage } from "@/domains/catalog/components/browse/browse-page";
import { getNavigateCalls } from "./browse-page-test-setup";

describe("BrowsePage navigation", () => {
  it("renders search-first browse controls and issues navigate updates for search interactions", () => {
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

    expect(screen.getByRole("heading", { name: "Find people and groups" })).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Browse Atlas" })).toBeNull();
    expect(screen.queryByText(/public civic graph/i)).toBeNull();
    expect(screen.getByText("Search by issue, place, or name.")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Grid" })).toBeNull();
    expect(screen.queryByRole("button", { name: "List" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Map" })).toBeNull();
    expect(screen.getByRole("link", { name: "Map" })).not.toBeNull();
    fireEvent.change(screen.getByPlaceholderText("Try housing in Detroit"), {
      target: { value: "housing" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.click(screen.getByRole("button", { name: "Missouri 10 matching records" }));
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
    expect(window.history.length).toBeGreaterThan(0);
  });

  it("defaults public actor discovery to list view and resets back to the readable list", () => {
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

    expect(screen.getByText("01")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Select Missouri" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    const resetSearch = getNavigateCalls()
      .map((options) =>
        typeof options.search === "function" ? options.search({ view: "map" }) : options.search,
      )
      .find((search) => search?.view === "list");

    expect(resetSearch).toMatchObject({ view: "list" });
  });

  it("renders grid and list views with state summaries", () => {
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

    expect(screen.getAllByText("Missouri").length).toBeGreaterThan(0);
    const missouriGridButton = screen.getByRole("button", { name: "Missouri 10 matching records" });
    fireEvent.click(missouriGridButton);

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
    fireEvent.click(screen.getByRole("button", { name: "02 California CA 5 records" }));
  });

  it("surfaces place-first and issue-first exploration starters", () => {
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

    const startingPoints = screen.getByRole("region", { name: "Browse starting points" });

    expect(startingPoints).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Missouri people and groups 10 records" }),
    ).not.toBeNull();
    expect(screen.getByRole("button", { name: "Housing Affordability landscape" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "People profiles" })).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Missouri Housing Affordability guided path" }),
    ).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Missouri people and groups 10 records" }));
    fireEvent.click(screen.getByRole("button", { name: "Housing Affordability landscape" }));
    fireEvent.click(screen.getByRole("button", { name: "People profiles" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Missouri Housing Affordability guided path" }),
    );

    const computedSearches = getNavigateCalls()
      .map((options) =>
        typeof options.search === "function" ? options.search({ view: "map" }) : options.search,
      )
      .filter(Boolean);

    expect(computedSearches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ offset: 0, states: "MO" }),
        expect.objectContaining({ offset: 0, issue_areas: "housing_affordability" }),
        expect.objectContaining({ offset: 0, entry_types: "person" }),
        expect.objectContaining({
          issue_areas: "housing_affordability",
          offset: 0,
          states: "MO",
          view: "list",
        }),
      ]),
    );
  });
});
