// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MapPage } from "@/domains/catalog/components/map/map-page";
import { makePoint } from "../../../../../helpers/catalog/map-clustering-harness";
import {
  installMapPageComponentMocks,
  readMapPageHarness,
  requireMapPageHarness,
  setMapPageChromeRevealed,
  setMapPageTaxonomy,
} from "../../../../../helpers/catalog/map-page-component-harness";
import type { MapPageSurfaceProps } from "@/domains/catalog/components/map/map-page-surface";

const routerNavigateSpy = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return { ...harness.installRouterMocks(), useNavigate: () => routerNavigateSpy };
});

vi.mock("@/domains/catalog/hooks/use-map-page", async () => {
  const { mapPageHookMock } =
    await import("../../../../../helpers/catalog/map-page-component-harness");
  return { useMapPage: mapPageHookMock };
});

vi.mock("@/domains/catalog/hooks/use-reduced-motion", () => ({
  useReducedMotion: () => false,
}));

vi.mock("@/domains/catalog/hooks/use-map-reveal", async () => {
  const { currentMapPageChromeRevealed } =
    await import("../../../../../helpers/catalog/map-page-component-harness");
  return {
    useMapReveal: () => ({ playing: false, chromeRevealed: currentMapPageChromeRevealed() }),
  };
});

vi.mock("@/domains/catalog/hooks/use-panel-camera", () => ({
  usePanelCamera: () => undefined,
}));

vi.mock("@/domains/catalog/hooks/use-taxonomy", async () => {
  const { currentMapPageTaxonomy } =
    await import("../../../../../helpers/catalog/map-page-component-harness");
  return { useTaxonomy: () => ({ data: currentMapPageTaxonomy() }) };
});

vi.mock("@/domains/catalog/components/map/map-page-surface", () => ({
  MapPageSurface: ({ surfaceRef, bounds, controlsRevealed }: MapPageSurfaceProps) => (
    <div ref={surfaceRef} tabIndex={-1} data-testid="surface">
      {bounds ? <div data-testid="markers" /> : null}
      {controlsRevealed ? <button type="button">Zoom in</button> : null}
    </div>
  ),
}));

beforeEach(async () => {
  const { resetRouterMocks } = await import("@/../tests/helpers/router-harness");
  resetRouterMocks();
  routerNavigateSpy.mockClear();
  installMapPageComponentMocks();
});

afterEach(cleanup);

describe("MapPage", () => {
  it("renders the basemap, markers, command bar, legend, and controls", () => {
    requireMapPageHarness().setState({ points: [makePoint({ id: "1", lat: 32, lng: -96 })] });
    render(<MapPage search={{}} />);

    expect(screen.getByTestId("surface")).toBeTruthy();
    expect(screen.getByTestId("markers")).toBeTruthy();
    expect(screen.getByRole("combobox")).toBeTruthy();
    expect(screen.getByRole("button", { name: /legend/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeTruthy();
  });

  it("announces the visible result count in a polite live region", () => {
    requireMapPageHarness().setState({
      points: [makePoint({ id: "1", lat: 1, lng: 2 }), makePoint({ id: "2", lat: 3, lng: 4 })],
    });
    render(<MapPage search={{}} />);

    const live = screen.getByRole("status");
    expect(live.getAttribute("aria-live")).toBe("polite");
    expect(live.textContent).toContain("Showing 2 people and groups");
  });

  it("offers a skip link straight to the parallel results list", () => {
    requireMapPageHarness().setState({ points: [makePoint({ id: "1", lat: 1, lng: 2 })] });
    render(<MapPage search={{}} />);
    const skip = screen.getByRole("link", { name: /Skip to results list/i });
    const resultsList = document.querySelector("#map-results-list");
    expect(skip.getAttribute("href")).toBe("#map-results-list");
    expect(resultsList).not.toBeNull();
    expect(resultsList?.getAttribute("tabindex")).toBe("-1");
    expect(resultsList?.className).toContain("focus-within:not-sr-only");
    expect(resultsList?.className).toContain("focus-within:absolute");
  });

  it("shows the result count pill when points are placed", () => {
    requireMapPageHarness().setState({ points: [makePoint({ id: "1", lat: 1, lng: 2 })] });
    render(<MapPage search={{}} />);
    expect(screen.getByText(/1 person or group in 1 place/i)).toBeTruthy();
  });

  it("shows the empty state with its actions when a viewport holds no actors", () => {
    requireMapPageHarness().setState({
      points: [],
      pointsQuery: { data: { points: [] }, isError: false },
    });
    render(<MapPage search={{}} />);

    expect(screen.getAllByText(/No people or groups here/i).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Zoom out to the US" }));
    expect(requireMapPageHarness().handlers.onZoomOut).toHaveBeenCalledOnce();
  });

  it("shows the error state and retries through the query when fetching fails", () => {
    const refetch = vi.fn();
    requireMapPageHarness().setState({
      points: [],
      pointsQuery: { data: undefined, isError: true, refetch },
    });
    render(<MapPage search={{}} />);

    expect(screen.getByText(/couldn.t load the map/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("shows the error state when the route could not seed initial points", () => {
    const refetch = vi.fn();
    requireMapPageHarness().setState({
      points: [],
      pointsQuery: { data: undefined, isError: false, refetch },
    });
    render(<MapPage search={{}} initialPointsLoadFailed />);

    expect(screen.getByText(/couldn.t load the map/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refetch).toHaveBeenCalledOnce();
    expect(readMapPageHarness().lastInitialPointsLoadFailed()).toBe(true);
  });

  it("opens the detail panel as a non-modal dialog when an actor is selected", () => {
    const point = makePoint({ id: "1", name: "Dallas Housing Trust" });
    requireMapPageHarness().setState({
      points: [point],
      selection: { kind: "actor", point, anchor: { lng: -96.8, lat: 32.78 } },
    });
    render(<MapPage search={{}} />);

    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("false");
    expect(dialog).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Close detail panel" }));
    expect(requireMapPageHarness().handlers.onClosePanel).toHaveBeenCalledOnce();
  });

  it("closes the panel and returns focus on Escape", () => {
    const point = makePoint({ id: "1", name: "Dallas Housing Trust" });
    requireMapPageHarness().setState({
      points: [point],
      selection: { kind: "actor", point, anchor: { lng: -96.8, lat: 32.78 } },
    });
    render(<MapPage search={{}} />);

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(requireMapPageHarness().handlers.onClosePanel).toHaveBeenCalledOnce();
    expect(screen.getByTestId("surface")).toHaveFocus();
  });

  it("does not render the panel when nothing is selected", () => {
    requireMapPageHarness().setState({ points: [makePoint({ id: "1" })], selection: null });
    render(<MapPage search={{}} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("hands the live viewport's handlers to the hook with the route search", () => {
    render(<MapPage search={{ issue_areas: "housing-affordability" }} />);
    expect(readMapPageHarness().lastSearch()).toMatchObject({
      issue_areas: "housing-affordability",
    });
  });

  it("renders without quick issues before the taxonomy has loaded", () => {
    setMapPageTaxonomy(undefined);
    requireMapPageHarness().setState({ points: [makePoint({ id: "1", lat: 1, lng: 2 })] });
    render(<MapPage search={{}} />);
    // The command bar still renders; it simply offers no issue picks yet.
    expect(screen.getByRole("combobox")).toBeTruthy();
  });

  it("holds the chrome hidden until the first-load reveal finishes", () => {
    setMapPageChromeRevealed(false);
    requireMapPageHarness().setState({ points: [makePoint({ id: "1", lat: 1, lng: 2 })] });
    const { container } = render(<MapPage search={{}} />);
    expect(container.querySelector(".opacity-0")).not.toBeNull();
  });

  it("waits to draw markers until the map reports its first viewport", () => {
    requireMapPageHarness().setState({
      bounds: null,
      points: [makePoint({ id: "1", lat: 1, lng: 2 })],
    });
    render(<MapPage search={{}} />);
    expect(screen.queryByTestId("markers")).toBeNull();
  });

  it("reads no selected dot id while a cluster's crowd is open", () => {
    const members = [makePoint({ id: "1" }), makePoint({ id: "2" })];
    requireMapPageHarness().setState({
      points: members,
      selection: { kind: "cluster", members, anchor: { lng: -96, lat: 32 }, clusterId: 9 },
    });
    render(<MapPage search={{}} />);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("ignores non-Escape keys pressed inside the open panel", () => {
    const point = makePoint({ id: "1", name: "Dallas Housing Trust" });
    requireMapPageHarness().setState({
      points: [point],
      selection: { kind: "actor", point, anchor: { lng: -96.8, lat: 32.78 } },
    });
    render(<MapPage search={{}} />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter" });
    expect(requireMapPageHarness().handlers.onClosePanel).not.toHaveBeenCalled();
  });

  it("hands the hook a fire-and-forget adapter over the router's navigate", () => {
    render(<MapPage search={{}} />);
    const navigate = readMapPageHarness().lastNavigate();
    if (!navigate) {
      throw new Error("Expected the page to hand a navigate to the hook.");
    }
    // The page never awaits a URL update; calling the adapter forwards to the
    // router as a side effect.
    navigate({ to: ".", search: { z: 9 } });
    expect(routerNavigateSpy).toHaveBeenCalledWith({ to: ".", search: { z: 9 } });
  });
});
