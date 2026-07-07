// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MapStyleProvider, useMapStyle } from "@/domains/catalog/components/map/map-style-context";
import { ATLAS_BASEMAP_STYLE_URL } from "@/domains/catalog/map/map-config";

afterEach(() => {
  cleanup();
});

describe("MapStyleProvider", () => {
  function MapStyleReader() {
    const { setStyleUrl, styleUrl } = useMapStyle();

    return (
      <div>
        <output aria-label="Current style">{styleUrl}</output>
        <button
          type="button"
          onClick={() => {
            setStyleUrl("https://tiles.example.com/atlas/style.json");
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
      <MapStyleProvider initialStyleUrl={ATLAS_BASEMAP_STYLE_URL}>
        <MapStyleReader />
      </MapStyleProvider>,
    );

    expect(screen.getByLabelText("Current style").textContent).toBe(ATLAS_BASEMAP_STYLE_URL);
  });

  it("updates the current map style through context", async () => {
    const user = userEvent.setup();
    render(
      <MapStyleProvider initialStyleUrl={ATLAS_BASEMAP_STYLE_URL}>
        <MapStyleReader />
      </MapStyleProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Change style" }));

    expect(screen.getByLabelText("Current style").textContent).toBe(
      "https://tiles.example.com/atlas/style.json",
    );
  });

  it("rejects relative initial styles", () => {
    expect(() =>
      render(
        <MapStyleProvider initialStyleUrl="/maps/atlas/style.json">
          <MapStyleReader />
        </MapStyleProvider>,
      ),
    ).toThrow("Map style URL must be an absolute http(s) URL.");
  });

  it("requires an explicit provider", () => {
    expect(() => render(<MissingProviderReader />)).toThrow(
      "MapStyleProvider is required before reading the map style.",
    );
  });
});
