// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorialActivityView } from "@/domains/editorial/editorial-activity-view";
import { APPROVAL, REFUSED_REMOVAL } from "../../../fixtures/editorial/editorial-activity";

afterEach(cleanup);

describe("EditorialActivityView", () => {
  it("lists who did what, to what and when, and marks refused attempts", () => {
    render(
      <EditorialActivityView
        hasMore={false}
        isLoading={false}
        isLoadingMore={false}
        items={[APPROVAL, REFUSED_REMOVAL]}
        onLoadMore={vi.fn()}
      />,
    );

    expect(screen.getByText("Approved a discovery review")).toBeInTheDocument();
    expect(screen.getByText(/editor@rebuildingus.org · Oct 8, 2026/)).toBeInTheDocument();
    expect(screen.getByText("item_id review-1")).toBeInTheDocument();
    expect(screen.getByText("Removed a discovery schedule")).toBeInTheDocument();
    expect(screen.getByText("Refused")).toBeInTheDocument();
    expect(screen.getByText("This action requires Atlas staff.")).toBeInTheDocument();
    expect(screen.queryByText(/^Reason:/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Show older" })).toBeNull();
  });

  it("shows why an editor made a decision", () => {
    render(
      <EditorialActivityView
        hasMore={false}
        isLoading={false}
        isLoadingMore={false}
        items={[{ ...APPROVAL, reason: "Matches the state filing." }]}
        onLoadMore={vi.fn()}
      />,
    );

    expect(screen.getByText("Reason: Matches the state filing.")).toBeInTheDocument();
  });

  it("loads older entries on request", () => {
    const onLoadMore = vi.fn();
    const { rerender } = render(
      <EditorialActivityView
        hasMore
        isLoading={false}
        isLoadingMore={false}
        items={[APPROVAL]}
        onLoadMore={onLoadMore}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Show older" }));
    expect(onLoadMore).toHaveBeenCalledOnce();

    rerender(
      <EditorialActivityView
        hasMore
        isLoading={false}
        isLoadingMore
        items={[APPROVAL]}
        onLoadMore={onLoadMore}
      />,
    );
    expect(screen.getByRole("button", { name: "Loading…" })).toBeDisabled();
  });

  it("shows loading, an empty log, and a load failure without the empty message", () => {
    const props = { hasMore: false, isLoadingMore: false, onLoadMore: vi.fn() };
    const { rerender } = render(<EditorialActivityView {...props} isLoading items={[]} />);
    expect(document.querySelector("[aria-busy]")).not.toBeNull();

    rerender(<EditorialActivityView {...props} isLoading={false} items={[]} />);
    expect(screen.getByText("No editorial changes yet.")).toBeInTheDocument();

    rerender(
      <EditorialActivityView
        {...props}
        errorMessage="Editorial activity could not load."
        isLoading={false}
        items={[]}
      />,
    );
    expect(screen.getByText("Editorial activity could not load.")).toBeInTheDocument();
    expect(screen.queryByText("No editorial changes yet.")).toBeNull();
  });
});
