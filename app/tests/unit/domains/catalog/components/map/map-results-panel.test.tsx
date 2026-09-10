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
  it("owns the skip target and stays visible as the map scan companion", () => {
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
    expect(panel?.className).not.toContain("sr-only");
    expect(panel?.className).toContain("absolute");
  });

  it("summarizes the visible civic landscape before the actor rows", () => {
    render(
      <MapResultsPanel
        points={[
          makePoint({
            id: "1",
            type: "organization",
            place_label: "Kansas City, MO",
            issue_areas: ["housing-affordability"],
            source_count: 2,
          }),
          makePoint({
            id: "2",
            type: "person",
            place_label: "Detroit, MI",
            issue_areas: ["worker_power"],
            source_count: 3,
          }),
        ]}
        isLoading={false}
        onFocusActor={vi.fn()}
      />,
    );

    expect(screen.getByText("Landscape")).toBeTruthy();
    expect(screen.getByText("2 people and groups")).toBeTruthy();
    expect(screen.getByText("2 places")).toBeTruthy();
    expect(screen.getByText("5 sources")).toBeTruthy();
    expect(screen.getByText("Housing Affordability")).toBeTruthy();
    expect(screen.getByText("Worker Power")).toBeTruthy();
    expect(screen.getByText("Organizations")).toBeTruthy();
    expect(screen.getByText("People")).toBeTruthy();
  });

  it("counts only the actors that carry a place", () => {
    render(
      <MapResultsPanel
        points={[
          makePoint({
            id: "1",
            type: "organization",
            place_label: "Tulsa, OK",
            issue_areas: ["housing-affordability"],
            source_count: 1,
          }),
          makePoint({
            id: "2",
            type: "organization",
            place_label: null,
            issue_areas: ["housing-affordability"],
            source_count: 1,
          }),
        ]}
        isLoading={false}
        onFocusActor={vi.fn()}
      />,
    );

    expect(screen.getByText("2 people and groups")).toBeTruthy();
    expect(screen.getByText("1 place")).toBeTruthy();
  });

  it("shows the loading state before rows arrive", () => {
    render(<MapResultsPanel points={[]} isLoading onFocusActor={vi.fn()} />);

    expect(screen.getByText("Loading")).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("shows the empty state when the viewport has no rows", () => {
    render(<MapResultsPanel points={[]} isLoading={false} onFocusActor={vi.fn()} />);

    expect(screen.getByText("No people or groups in this area.")).toBeTruthy();
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
