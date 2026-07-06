import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ConnectionsGraph } from "./connections-graph";
import type { ConnectionsData } from "../../types";

afterEach(() => {
  cleanup();
});

const TWO_ITEM_DATA: ConnectionsData = {
  entity_id: "entity-1",
  items: [
    {
      entity: {
        id: "entity-2",
        name: "Acme Housing Collective",
        type: "organization",
        place_label: "Columbus, OH",
        trust_level: "atlas_verified",
        source_count: 3,
      },
      relationships: [
        { type: "shared_place", issue_area_ids: [], source_ids: [] },
        {
          type: "shared_issue_area",
          issue_area_ids: ["housing", "criminal-justice"],
          source_ids: [],
        },
      ],
    },
    {
      entity: {
        id: "entity-3",
        name: "Jane Doe",
        type: "person",
        place_label: null,
        trust_level: "unverified",
        source_count: 1,
      },
      relationships: [
        { type: "affiliated_organization", issue_area_ids: [], source_ids: [] },
      ],
    },
  ],
  total: 12,
  next_cursor: "2",
};

const EMPTY_DATA: ConnectionsData = {
  entity_id: "entity-1",
  items: [],
  total: 0,
  next_cursor: null,
};

describe("ConnectionsGraph", () => {
  it("renders a row per related entity with its name, type/location, trust badge, and relationship pills", () => {
    render(
      <ConnectionsGraph
        data={TWO_ITEM_DATA}
        onLoadMore={vi.fn()}
        isLoadingMore={false}
      />,
    );

    expect(screen.getByText("Showing 2 of 12")).toBeInTheDocument();

    expect(screen.getByText("Acme Housing Collective")).toBeInTheDocument();
    expect(screen.getByText("Organization · Columbus, OH")).toBeInTheDocument();
    expect(screen.getByText("✓ Atlas-verified")).toBeInTheDocument();
    expect(screen.getByText("3 sources")).toBeInTheDocument();
    expect(screen.getByText("Same place")).toBeInTheDocument();
    expect(
      screen.getByText("Shared issue: Housing, Criminal Justice"),
    ).toBeInTheDocument();

    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    expect(screen.getByText("Person")).toBeInTheDocument();
    expect(screen.getByText("Unverified")).toBeInTheDocument();
    expect(screen.getByText("1 source")).toBeInTheDocument();
    expect(screen.getByText("Same organization")).toBeInTheDocument();
  });

  it("renders an empty-state message and a zero count when there are no connections", () => {
    render(
      <ConnectionsGraph
        data={EMPTY_DATA}
        onLoadMore={vi.fn()}
        isLoadingMore={false}
      />,
    );

    expect(screen.getByText("Showing 0 of 0")).toBeInTheDocument();
    expect(screen.getByText("No connections found.")).toBeInTheDocument();
  });

  it("does not render a Load more button when there is no further page", () => {
    render(
      <ConnectionsGraph
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
      <ConnectionsGraph
        data={TWO_ITEM_DATA}
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
      <ConnectionsGraph
        data={TWO_ITEM_DATA}
        onLoadMore={vi.fn()}
        isLoadingMore={true}
      />,
    );

    const button = screen.getByRole("button", { name: "Loading…" });
    expect(button).toBeDisabled();
  });

  it("renders no relationship pills for a related entity with no relationships", () => {
    const dataWithNoRelationships: ConnectionsData = {
      entity_id: "entity-1",
      items: [
        {
          entity: {
            id: "entity-4",
            name: "No Relationships Org",
            type: "organization",
            place_label: null,
            trust_level: "unverified",
            source_count: 0,
          },
          relationships: [],
        },
      ],
      total: 1,
      next_cursor: null,
    };

    render(
      <ConnectionsGraph
        data={dataWithNoRelationships}
        onLoadMore={vi.fn()}
        isLoadingMore={false}
      />,
    );

    expect(screen.getByText("No Relationships Org")).toBeInTheDocument();
    expect(screen.queryByText(/Same/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Shared/)).not.toBeInTheDocument();
  });
});
