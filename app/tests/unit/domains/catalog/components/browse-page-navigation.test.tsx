// @vitest-environment jsdom

import "./browse-page-test-setup";

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BrowsePage } from "@/domains/catalog/components/browse/browse-page";
import { getNavigateCalls, mocks } from "./browse-page-test-setup";

describe("BrowsePage navigation", () => {
  it("shows a paginated people directory with search and place filters but no removable type", () => {
    render(
      <BrowsePage
        search={{ view: "list" }}
        page={{
          description: "Find people by name, issue, or place.",
          eyebrow: "Directory",
          title: "People",
          lockedEntryTypes: ["person"],
          resultLabelPlural: "people",
          resultsHeading: "People",
          searchLabel: "Search people by name, issue, or place",
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: "People", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Search results" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "People", level: 2 })).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "Search people by name, issue, or place" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Find people by name, issue, or place.")).toBeInTheDocument();
    expect(mocks.useEntries).toHaveBeenCalledWith(
      expect.objectContaining({ entry_types: ["person"], limit: 20 }),
      expect.anything(),
    );
    expect(screen.queryByRole("button", { name: "Remove People" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Filter/ }));
    expect(screen.queryByRole("button", { name: /^Types/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(
      getNavigateCalls().some(
        (call) => typeof call.search === "function" && call.search({}).offset === 20,
      ),
    ).toBe(true);
  });

  it("renders editorial browse controls and issues navigate updates for browse interactions", () => {
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

    expect(screen.getByRole("heading", { name: "Browse Atlas" })).toBeInTheDocument();
    expect(
      screen.queryByText(
        "Start with the places, issues, people, and records already visible in Atlas.",
      ),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Grid" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "List" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Map" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Map" })).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Try housing in Detroit"), {
      target: { value: "housing" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    fireEvent.click(screen.getByRole("button", { name: /Filter/ }));
    fireEvent.click(screen.getByRole("button", { name: "Housing Affordability" }));

    const placesSection = screen.getByRole("region", { name: "Places" });
    fireEvent.click(within(placesSection).getByRole("button", { name: "Missouri 10 records" }));

    const computedSearches = getNavigateCalls()
      .map((options) =>
        typeof options.search === "function"
          ? options.search({ query: "old", view: "map" })
          : options.search,
      )
      .filter(Boolean);

    expect(computedSearches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          issue_areas: "housing_affordability",
          offset: 0,
          query: undefined,
          view: "list",
        }),
        expect.objectContaining({ view: "list" }),
        expect.objectContaining({ offset: 0, issue_areas: "housing_affordability", view: "list" }),
        expect.objectContaining({ offset: 0, states: "MO", view: "list" }),
      ]),
    );
  });

  it("renders active filters as result mode instead of grid or list state summaries", () => {
    render(
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

    expect(screen.getByRole("region", { name: "Search results" })).toBeInTheDocument();
    expect(screen.getByText("Entry list total: 25")).toBeInTheDocument();
    expect(screen.queryByText("01")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Ecosystem history" })).not.toBeInTheDocument();
  });
});
