import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PaginatedListShell } from "./paginated-list-shell";

afterEach(() => {
  cleanup();
});

interface Row {
  id: string;
  label: string;
}

const ROWS: Row[] = [
  { id: "row-1", label: "First" },
  { id: "row-2", label: "Second" },
];

describe("PaginatedListShell", () => {
  it("renders the count and one row per item via children", () => {
    render(
      <PaginatedListShell
        items={ROWS}
        total={5}
        nextCursor={null}
        onLoadMore={vi.fn()}
        isLoadingMore={false}
        emptyMessage="Nothing here."
        itemKey={(row) => row.id}
      >
        {(row: Row) => <span>{row.label}</span>}
      </PaginatedListShell>,
    );

    expect(screen.getByText("Showing 2 of 5")).toBeInTheDocument();
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();
  });

  it("renders the empty message and a zero count when there are no items", () => {
    render(
      <PaginatedListShell
        items={[]}
        total={0}
        nextCursor={null}
        onLoadMore={vi.fn()}
        isLoadingMore={false}
        emptyMessage="Nothing here."
        itemKey={(row) => row.id}
      >
        {(row: Row) => <span>{row.label}</span>}
      </PaginatedListShell>,
    );

    expect(screen.getByText("Showing 0 of 0")).toBeInTheDocument();
    expect(screen.getByText("Nothing here.")).toBeInTheDocument();
  });

  it("hides Load more when nextCursor is null", () => {
    render(
      <PaginatedListShell
        items={ROWS}
        total={2}
        nextCursor={null}
        onLoadMore={vi.fn()}
        isLoadingMore={false}
        emptyMessage="Nothing here."
        itemKey={(row) => row.id}
      >
        {(row: Row) => <span>{row.label}</span>}
      </PaginatedListShell>,
    );

    expect(
      screen.queryByRole("button", { name: /load more/i }),
    ).not.toBeInTheDocument();
  });

  it("calls onLoadMore when Load more is clicked", () => {
    const onLoadMore = vi.fn().mockResolvedValue(undefined);
    render(
      <PaginatedListShell
        items={ROWS}
        total={5}
        nextCursor="2"
        onLoadMore={onLoadMore}
        isLoadingMore={false}
        emptyMessage="Nothing here."
        itemKey={(row) => row.id}
      >
        {(row: Row) => <span>{row.label}</span>}
      </PaginatedListShell>,
    );

    const button = screen.getByRole("button", { name: "Load more" });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("renders a disabled, loading Load more button while isLoadingMore is true", () => {
    render(
      <PaginatedListShell
        items={ROWS}
        total={5}
        nextCursor="2"
        onLoadMore={vi.fn()}
        isLoadingMore={true}
        emptyMessage="Nothing here."
        itemKey={(row) => row.id}
      >
        {(row: Row) => <span>{row.label}</span>}
      </PaginatedListShell>,
    );

    expect(screen.getByRole("button", { name: "Loading…" })).toBeDisabled();
  });
});
