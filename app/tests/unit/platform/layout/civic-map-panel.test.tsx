// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CivicMapPanel } from "@/platform/layout/civic-map-panel";
import {
  FALLBACK_ISSUE_COLOR,
  issueColor,
} from "@rebuildingamerica/atlas-catalog/map/issue-colors";
import { createEntryFixture } from "@/../tests/fixtures/catalog/entries";
import {
  civicMapEntriesReply,
  stubCivicMapRects,
} from "@/../tests/helpers/layout/civic-map-panel-harness";
import type {
  MockComposableMapProps,
  MockGeographiesProps,
  MockGeographyProps,
  MockMarkerProps,
} from "@/../tests/helpers/layout/civic-map-panel-harness";

const mocks = vi.hoisted(() => ({
  listEntries: vi.fn(),
}));

vi.mock("@rebuildingamerica/atlas-api-client", () => ({
  api: {
    entries: {
      list: mocks.listEntries,
    },
  },
}));

vi.mock("react-simple-maps", () => ({
  ComposableMap: ({
    "aria-label": ariaLabel,
    children,
    className,
    height,
    projection,
    width,
  }: MockComposableMapProps) => (
    <svg
      aria-label={ariaLabel}
      className={className}
      data-projection={projection}
      viewBox={`0 0 ${width ?? 0} ${height ?? 0}`}
    >
      {children}
    </svg>
  ),
  Geographies: ({ children, geography }: MockGeographiesProps) => {
    const geographies = geography.objects.states.geometries.map((state) => ({
      id: state.id,
      properties: state.properties,
      rsmKey: state.id,
    }));

    return <g data-testid="auth-us-geographies">{children({ geographies })}</g>;
  },
  Geography: ({ "aria-label": ariaLabel, geography }: MockGeographyProps) => (
    <path aria-label={ariaLabel} data-state-name={geography.properties.name} />
  ),
  Marker: ({ children, coordinates }: MockMarkerProps) => (
    <g data-coordinates={coordinates?.join(",")}>{children}</g>
  ),
}));

afterEach(() => {
  cleanup();
});

describe("CivicMapPanel", () => {
  it("renders source-backed United States geography with Alaska and Hawaii", async () => {
    mocks.listEntries.mockResolvedValue(civicMapEntriesReply());

    render(<CivicMapPanel />);

    const map = screen.getByLabelText("United States map");

    expect(map).toHaveAttribute("data-projection", "geoAlbersUsa");
    expect(screen.getByLabelText("Alaska")).toBeInTheDocument();
    expect(screen.getByLabelText("Hawaii")).toBeInTheDocument();
    expect(screen.getByLabelText("California")).toBeInTheDocument();
    await waitFor(() => {
      expect(mocks.listEntries).toHaveBeenCalledWith({ limit: 50 });
    });
  });

  it("shows the directory totals once the entry list resolves", async () => {
    mocks.listEntries.mockResolvedValue(
      civicMapEntriesReply({
        cities: ["Jackson", "Denver"],
        issueAreas: ["housing_affordability", "climate", "voting_rights"],
        total: 4210,
      }),
    );

    render(<CivicMapPanel />);

    expect(screen.getAllByText("—")).toHaveLength(3);

    expect(await screen.findByText("4,210")).toBeInTheDocument();
    expect(screen.getByText("people and groups")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.queryByText("—")).not.toBeInTheDocument();
  });

  it("plots only the entries whose city and state resolve to known coordinates", async () => {
    mocks.listEntries.mockResolvedValue(
      civicMapEntriesReply({
        entries: [
          createEntryFixture({ id: "plotted", city: "Jackson", state: "MS" }),
          createEntryFixture({ id: "no-city", city: undefined, state: "MS" }),
          createEntryFixture({ id: "no-state", city: "Jackson", state: undefined }),
          createEntryFixture({ id: "unmapped-city", city: "Nowhereville", state: "MS" }),
        ],
        total: 4,
      }),
    );

    const view = render(<CivicMapPanel />);

    await waitFor(() => {
      expect(view.container.querySelectorAll("[data-coordinates]")).toHaveLength(1);
    });
    expect(view.container.querySelector("[data-coordinates]")).toHaveAttribute(
      "data-coordinates",
      "-90.18,32.3",
    );
  });

  it("colours a marker by its first issue area and falls back when it has none", async () => {
    mocks.listEntries.mockResolvedValue(
      civicMapEntriesReply({
        entries: [
          createEntryFixture({
            id: "housing",
            city: "Jackson",
            state: "MS",
            issue_areas: ["housing-affordability"],
          }),
          createEntryFixture({
            id: "unlabelled",
            city: "Denver",
            state: "CO",
            issue_areas: [],
          }),
        ],
        total: 2,
      }),
    );

    const view = render(<CivicMapPanel />);

    await waitFor(() => {
      expect(view.container.querySelectorAll("[data-coordinates]")).toHaveLength(2);
    });

    const markers = Array.from(view.container.querySelectorAll("[data-coordinates]"));
    const housingFill = markers[0]?.querySelectorAll("circle")[1]?.getAttribute("fill");
    const unlabelledFill = markers[1]?.querySelectorAll("circle")[1]?.getAttribute("fill");

    expect(housingFill).toBe(issueColor("housing-affordability"));
    expect(unlabelledFill).toBe(FALLBACK_ISSUE_COLOR);
    expect(housingFill).not.toBe(unlabelledFill);
  });

  it("opens a tooltip beside the hovered marker and enlarges it while hovered", async () => {
    stubCivicMapRects(
      { height: 300, left: 0, top: 0, width: 400 },
      { height: 10, left: 50, top: 100, width: 10 },
    );
    mocks.listEntries.mockResolvedValue(
      civicMapEntriesReply({
        entries: [
          createEntryFixture({
            id: "kc",
            name: "KC Tenants",
            city: "Kansas City",
            state: "MO",
            issue_areas: ["housing_affordability", "civil_rights"],
          }),
        ],
        total: 1,
      }),
    );

    const view = render(<CivicMapPanel />);

    const marker = await waitFor(() => {
      const found = view.container.querySelector("[data-coordinates] g");
      if (!found) throw new Error("Expected a rendered marker");
      return found;
    });

    expect(marker.querySelectorAll("circle")[1]).toHaveAttribute("r", "2.8");

    fireEvent.mouseEnter(marker);

    expect(screen.getByText("KC Tenants")).toBeInTheDocument();
    expect(screen.getByText("housing_affordability · civil_rights")).toBeInTheDocument();
    expect(screen.getByText("Kansas City, MO")).toBeInTheDocument();
    expect(marker.querySelectorAll("circle")[1]).toHaveAttribute("r", "5");

    // The marker's centre sits at x=55 in a 400px-wide panel, so the 175px
    // tooltip still fits to its right.
    expect(screen.getByText("KC Tenants").parentElement).toHaveStyle({
      left: "67px",
      top: "83px",
    });

    fireEvent.mouseLeave(marker);

    expect(screen.queryByText("KC Tenants")).not.toBeInTheDocument();
    expect(marker.querySelectorAll("circle")[1]).toHaveAttribute("r", "2.8");
  });

  it("flips the tooltip to the left of a marker near the right edge", async () => {
    stubCivicMapRects(
      { height: 300, left: 0, top: 0, width: 400 },
      { height: 10, left: 380, top: 5, width: 10 },
    );
    mocks.listEntries.mockResolvedValue(
      civicMapEntriesReply({
        entries: [
          createEntryFixture({
            id: "edge",
            name: "Edge Coalition",
            city: "Denver",
            state: "CO",
            issue_areas: [],
          }),
        ],
        total: 1,
      }),
    );

    const view = render(<CivicMapPanel />);

    const marker = await waitFor(() => {
      const found = view.container.querySelector("[data-coordinates] g");
      if (!found) throw new Error("Expected a rendered marker");
      return found;
    });

    fireEvent.mouseEnter(marker);

    // 385 + 12 + 175 overruns the 400px panel, so the tooltip flips to the
    // marker's left, and the marker sits too high for the 22px lift to stay
    // on screen.
    expect(screen.getByText("Edge Coalition").parentElement).toHaveStyle({
      left: "198px",
      top: "0px",
    });
    expect(screen.getByText("Denver, CO")).toBeInTheDocument();
    expect(screen.queryByText("·")).not.toBeInTheDocument();
  });

  it("says the directory could not be reached instead of drawing an empty country", async () => {
    mocks.listEntries.mockRejectedValue(new Error("API unavailable"));

    render(<CivicMapPanel />);

    expect(screen.getByLabelText("United States map")).toBeInTheDocument();
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Live counts and locations could not be loaded. The map is incomplete, not empty.",
    );
    expect(screen.queryByText("—")).not.toBeInTheDocument();
    expect(screen.queryByText("people and groups")).not.toBeInTheDocument();
  });

  it("ignores a reply that lands after the panel unmounts", async () => {
    let resolveList: ((value: unknown) => void) | undefined;
    mocks.listEntries.mockReturnValue(
      new Promise((resolve) => {
        resolveList = resolve;
      }),
    );

    const view = render(<CivicMapPanel />);
    view.unmount();
    resolveList?.(civicMapEntriesReply({ cities: ["Denver"], total: 9 }));

    await waitFor(() => {
      expect(mocks.listEntries).toHaveBeenCalledWith({ limit: 50 });
    });
    expect(screen.queryByText("9")).not.toBeInTheDocument();
  });

  it("ignores a failure that lands after the panel unmounts", async () => {
    let rejectList: ((reason: Error) => void) | undefined;
    mocks.listEntries.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectList = reject;
      }),
    );

    const view = render(<CivicMapPanel />);
    view.unmount();
    rejectList?.(new Error("API unavailable"));

    await waitFor(() => {
      expect(mocks.listEntries).toHaveBeenCalledWith({ limit: 50 });
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
