// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  ClusterSkeletons,
  MapEmptyState,
  MapErrorState,
  SparsityPill,
} from "@/domains/catalog/components/map/map-states";

afterEach(cleanup);

describe("ClusterSkeletons", () => {
  it("shims placeholder bubbles over the basemap, marked away from the reader", () => {
    const { container } = render(<ClusterSkeletons />);
    expect(container.querySelectorAll("[data-skeleton]").length).toBeGreaterThan(0);
    expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("MapEmptyState", () => {
  it("invites the visitor to widen the view or clear their filters", () => {
    const onZoomOut = vi.fn();
    const onClearFilters = vi.fn();
    render(
      <MapEmptyState hasActiveFilters onZoomOut={onZoomOut} onClearFilters={onClearFilters} />,
    );

    expect(screen.getByText(/No actors in this area yet/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Zoom out to the US" }));
    expect(onZoomOut).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(onClearFilters).toHaveBeenCalledOnce();
  });

  it("omits the clear-filters action when no filters are active", () => {
    render(<MapEmptyState hasActiveFilters={false} onZoomOut={vi.fn()} onClearFilters={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();
  });
});

describe("MapErrorState", () => {
  it("shows safe copy and a retry, never the raw error", () => {
    const onRetry = vi.fn();
    render(<MapErrorState onRetry={onRetry} />);

    expect(screen.getByText(/couldn.t load the map/i)).toBeTruthy();
    expect(screen.queryByText(/Error:/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

describe("SparsityPill", () => {
  it("renders the honest framing copy", () => {
    render(<SparsityPill label="Atlas is mapping civic work — 3 actors in 2 places so far" />);
    expect(
      screen.getByText("Atlas is mapping civic work — 3 actors in 2 places so far"),
    ).toBeTruthy();
  });
});
