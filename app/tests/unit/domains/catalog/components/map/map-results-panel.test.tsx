// @vitest-environment jsdom

import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  MAP_RESULTS_LIST_ID,
  MapResultsPanel,
} from "@/domains/catalog/components/map/map-results-panel";
import { makePoint } from "../../../../../helpers/catalog/map-clustering-harness";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

beforeEach(async () => {
  const { resetRouterMocks } = await import("@/../tests/helpers/router-harness");
  resetRouterMocks();
});

afterEach(cleanup);

describe("MapResultsPanel", () => {
  it("owns the skip target and focus-revealed layout", () => {
    const panelRef = createRef<HTMLElement>();
    render(
      <MapResultsPanel
        panelRef={panelRef}
        points={[makePoint({ id: "1", lat: 1, lng: 2 })]}
        isLoading={false}
        onFocusActor={vi.fn()}
      />,
    );

    const panel = document.querySelector(`#${MAP_RESULTS_LIST_ID}`);
    expect(panel).not.toBeNull();
    expect(panelRef.current).toBe(panel);
    expect(panel?.getAttribute("tabindex")).toBe("-1");
    expect(panel?.getAttribute("aria-label")).toBe("Civic actors on the map");
    expect(panel?.className).toContain("focus-within:not-sr-only");
    expect(panel?.className).toContain("focus-within:absolute");
  });

  it("shows the loading state before rows arrive", () => {
    render(<MapResultsPanel points={[]} isLoading onFocusActor={vi.fn()} />);

    expect(screen.getByText("Loading")).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("shows the empty state when the viewport has no rows", () => {
    render(<MapResultsPanel points={[]} isLoading={false} onFocusActor={vi.fn()} />);

    expect(screen.getByText("No people or groups in view.")).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("delegates populated rows to the data list", () => {
    render(
      <MapResultsPanel
        points={[makePoint({ id: "1", name: "Dallas Housing Trust" })]}
        isLoading={false}
        onFocusActor={vi.fn()}
      />,
    );

    expect(screen.getByRole("list")).toBeTruthy();
    expect(screen.getByText("Dallas Housing Trust")).toBeTruthy();
  });
});
