// @vitest-environment jsdom

import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MapPageSurface } from "@/domains/catalog/components/map/map-page-surface";
import { CONUS_VIEW } from "@rebuildingamerica/atlas-catalog/map/map-viewport";
import { CONUS_BOUNDS } from "../../../../../helpers/catalog/map-clustering-harness";

vi.mock("@/domains/catalog/components/map/map-interactive-surface", () => ({
  MapInteractiveSurface: ({ zoom }: { zoom: number }) => (
    <div data-testid="interactive-surface">zoom {zoom}</div>
  ),
}));

afterEach(cleanup);

describe("MapPageSurface", () => {
  it("shows a quiet placeholder before the WebGL chunk arrives, then the map", async () => {
    const surfaceRef = createRef<HTMLDivElement>();
    const { container } = render(
      <MapPageSurface
        bounds={CONUS_BOUNDS}
        controlsRevealed
        initialView={CONUS_VIEW}
        onLoad={vi.fn()}
        onMapReady={vi.fn()}
        onMoveEnd={vi.fn()}
        onSelectCluster={vi.fn()}
        onSelectPoint={vi.fn()}
        points={[]}
        reducedMotion={false}
        selection={null}
        surfaceRef={surfaceRef}
        zoom={5}
      />,
    );

    // Nothing announced while the chunk loads — just page-coloured space.
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(screen.queryByTestId("interactive-surface")).toBeNull();

    expect(await screen.findByTestId("interactive-surface")).toHaveTextContent("zoom 5");

    // The shell keeps a focus target so closing the panel can return focus here.
    expect(surfaceRef.current).toBe(container.firstChild);
    expect(surfaceRef.current).toHaveAttribute("tabindex", "-1");
  });
});
