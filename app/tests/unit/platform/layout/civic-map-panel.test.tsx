// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CivicMapPanel } from "@/platform/layout/civic-map-panel";
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
    mocks.listEntries.mockResolvedValue({
      data: [],
      facets: { cities: [], issue_areas: [] },
      pagination: { total: 0 },
    });

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

  it("keeps the map shell stable when summary stats cannot load", async () => {
    mocks.listEntries.mockRejectedValue(new Error("API unavailable"));

    render(<CivicMapPanel />);

    expect(screen.getByLabelText("United States map")).toBeInTheDocument();
    await waitFor(() => {
      expect(mocks.listEntries).toHaveBeenCalledWith({ limit: 50 });
    });
    expect(screen.getAllByText("—")).toHaveLength(3);
  });
});
