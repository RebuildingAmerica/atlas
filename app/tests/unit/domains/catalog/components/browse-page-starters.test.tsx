// @vitest-environment jsdom

import "./browse-page-test-setup";

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BrowsePage } from "@/domains/catalog/components/browse/browse-page";
import { mocks } from "./browse-page-test-setup";

describe("BrowsePage starters", () => {
  it("keeps starter context in one broad surface instead of comparison cards", () => {
    mocks.useTaxonomy.mockReturnValue({
      data: {
        Housing: [
          {
            description: "Housing policy",
            name: "Housing Affordability",
            slug: "housing_affordability",
          },
          {
            description: "Tenant organizing",
            name: "Tenant Organizing",
            slug: "tenant_organizing",
          },
        ],
      },
    });
    mocks.useEntries.mockReturnValue({
      data: {
        data: [{ id: "entry_123" }],
        facets: {
          issue_areas: [
            { count: 12, value: "housing_affordability" },
            { count: 7, value: "tenant_organizing" },
          ],
          states: [
            { count: 12, value: "MO" },
            { count: 9, value: "CA" },
          ],
        },
        pagination: {
          has_more: false,
          limit: 20,
          offset: 0,
          total: 21,
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
          view: "map",
        }}
      />,
    );

    expect(screen.queryByRole("region", { name: "Landscape comparison" })).toBeNull();
    expect(screen.queryByText("Compare places")).toBeNull();
    expect(screen.queryByText("Compare issues")).toBeNull();
    expect(screen.getByRole("region", { name: "Browse starting points" })).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Missouri people and groups 12 records" }),
    ).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "California people and groups 9 records" }),
    ).not.toBeNull();
    expect(screen.getByRole("button", { name: "Housing Affordability landscape" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Tenant Organizing landscape" })).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "California people and groups 9 records" }));
    fireEvent.click(screen.getByRole("button", { name: "Tenant Organizing landscape" }));

    expect(mocks.navigate).toHaveBeenCalled();
  });

  it("uses result facets for issue starters before taxonomy hydrates", () => {
    mocks.useTaxonomy.mockReturnValue({
      data: undefined,
    });
    mocks.useEntries.mockReturnValue({
      data: {
        data: [{ id: "entry_123" }],
        facets: {
          issue_areas: [{ count: 8, value: "worker_power" }],
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
          states: undefined,
          view: "map",
        }}
      />,
    );

    expect(screen.getByRole("button", { name: "Worker Power landscape" })).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Worker Power landscape" }));

    expect(mocks.navigate).toHaveBeenCalled();
  });

  it("keeps canonical issue starters when taxonomy and issue facets are unavailable", () => {
    mocks.useTaxonomy.mockReturnValue({
      data: undefined,
    });
    mocks.useEntries.mockReturnValue({
      data: {
        data: [{ id: "entry_123" }],
        facets: {
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
          states: undefined,
          view: "map",
        }}
      />,
    );

    expect(screen.getByRole("button", { name: "Housing Affordability landscape" })).not.toBeNull();
  });
});
