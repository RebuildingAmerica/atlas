import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SearchResultsList } from "./search-results-list";
import type { SearchResultsData } from "../../types";

afterEach(() => {
  cleanup();
});

const TWO_ROW_DATA: SearchResultsData = {
  items: [
    {
      id: "entity-1",
      name: "Jane Doe",
      type: "person",
      place_label: "Columbus, OH",
      trust_level: "atlas_verified",
      source_count: 3,
    },
    {
      id: "entity-2",
      name: "Acme Housing Collective",
      type: "organization",
      place_label: null,
      trust_level: "unverified",
      source_count: 1,
    },
  ],
  total: 12,
  next_cursor: "2",
};

const EMPTY_DATA: SearchResultsData = {
  items: [],
  total: 0,
  next_cursor: null,
};

describe("SearchResultsList", () => {
  it("renders a row per result with its name, type/location, and trust badge, plus the result count", () => {
    render(
      <SearchResultsList
        data={TWO_ROW_DATA}
        onLoadMore={vi.fn()}
        isLoadingMore={false}
      />,
    );

    expect(screen.getByText("Showing 2 of 12")).toBeInTheDocument();

    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    expect(screen.getByText("Person · Columbus, OH")).toBeInTheDocument();
    expect(screen.getByText("✓ Atlas-verified")).toBeInTheDocument();
    expect(screen.getByText("3 sources")).toBeInTheDocument();

    expect(screen.getByText("Acme Housing Collective")).toBeInTheDocument();
    expect(screen.getByText("Organization")).toBeInTheDocument();
    expect(screen.getByText("Unverified")).toBeInTheDocument();
    expect(screen.getByText("1 source")).toBeInTheDocument();
  });

  it("renders an empty-state message and a zero count when there are no results", () => {
    render(
      <SearchResultsList
        data={EMPTY_DATA}
        onLoadMore={vi.fn()}
        isLoadingMore={false}
      />,
    );

    expect(screen.getByText("Showing 0 of 0")).toBeInTheDocument();
    expect(screen.getByText("No matching entities found.")).toBeInTheDocument();
  });

  it("does not render a Load more button when there is no further page", () => {
    render(
      <SearchResultsList
        data={EMPTY_DATA}
        onLoadMore={vi.fn()}
        isLoadingMore={false}
      />,
    );

    expect(
      screen.queryByRole("button", { name: /load more/i }),
    ).not.toBeInTheDocument();
  });

  it("renders an enabled Load more button that calls onLoadMore when clicked", () => {
    const onLoadMore = vi.fn().mockResolvedValue(undefined);
    render(
      <SearchResultsList
        data={TWO_ROW_DATA}
        onLoadMore={onLoadMore}
        isLoadingMore={false}
      />,
    );

    const button = screen.getByRole("button", { name: "Load more" });
    expect(button).toBeEnabled();

    fireEvent.click(button);

    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("renders a disabled, loading Load more button while isLoadingMore is true", () => {
    render(
      <SearchResultsList
        data={TWO_ROW_DATA}
        onLoadMore={vi.fn()}
        isLoadingMore={true}
      />,
    );

    const button = screen.getByRole("button", { name: "Loading…" });
    expect(button).toBeDisabled();
  });
});
