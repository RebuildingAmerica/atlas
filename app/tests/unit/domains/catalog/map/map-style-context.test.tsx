// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MapStyleProvider, useMapStyle } from "@/domains/catalog/components/map/map-style-context";
import { ATLAS_BASEMAP_STYLE } from "@/domains/catalog/map/map-config";

afterEach(() => {
  cleanup();
});

describe("MapStyleProvider", () => {
  function MapStyleReader() {
    const { setStyle, style } = useMapStyle();

    return (
      <div>
        <output aria-label="Current style">{style.layers[0]?.id}</output>
        <button
          type="button"
          onClick={() => {
            setStyle({
              version: 8,
              sources: {},
              layers: [
                {
                  id: "alternate-paper",
                  type: "background",
                  paint: { "background-color": "#ffffff" },
                },
              ],
            });
          }}
        >
          Change style
        </button>
      </div>
    );
  }

  function MissingProviderReader() {
    useMapStyle();
    return null;
  }

  it("provides the configured Atlas basemap style", () => {
    render(
      <MapStyleProvider initialStyle={ATLAS_BASEMAP_STYLE}>
        <MapStyleReader />
      </MapStyleProvider>,
    );

    expect(screen.getByLabelText("Current style").textContent).toBe("atlas-paper");
  });

  it("updates the current map style through context", async () => {
    const user = userEvent.setup();
    render(
      <MapStyleProvider initialStyle={ATLAS_BASEMAP_STYLE}>
        <MapStyleReader />
      </MapStyleProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Change style" }));

    expect(screen.getByLabelText("Current style").textContent).toBe("alternate-paper");
  });

  it("requires an explicit provider", () => {
    expect(() => render(<MissingProviderReader />)).toThrow(
      "MapStyleProvider is required before reading the map style.",
    );
  });
});
