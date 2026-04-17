// @vitest-environment jsdom

import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { UsMapSurface } from "@/domains/catalog/components/browse/us-map-surface";
import { STATE_NAME_BY_CODE } from "@/domains/catalog/us-state-grid";

vi.mock("react-simple-maps", () => ({
  ComposableMap: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Geographies: (props: {
    children(input: {
      geographies: {
        id: string;
        properties: { name: string };
        rsmKey: string;
      }[];
    }): ReactNode;
  }) => {
    return (
      <div>
        {props.children({
          geographies: [
            { id: "06", properties: { name: "Golden State" }, rsmKey: "ca" },
            { id: "29", properties: { name: "Show Me State" }, rsmKey: "mo" },
            { id: "99", properties: { name: "Unknown" }, rsmKey: "unknown" },
          ],
        })}
      </div>
    );
  },
  Geography: ({
    "aria-label": ariaLabel,
    onClick,
  }: {
    "aria-label": string;
    onClick: () => void;
  }) => (
    <button type="button" aria-label={ariaLabel} onClick={onClick}>
      {ariaLabel}
    </button>
  ),
}));

afterEach(() => {
  cleanup();
});

describe("UsMapSurface", () => {
  it("renders map state labels, density legend, and selection handling", () => {
    const onSelectState = vi.fn();

    render(
      <UsMapSurface
        stateDensity={[
          { state: "CA", count: 12, intensity: 1 },
          { state: "MO", count: 6, intensity: 0.5 },
        ]}
        selectedState="CA"
        onSelectState={onSelectState}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "California, 12 results" }));
    fireEvent.click(screen.getByRole("button", { name: "Missouri, 6 results" }));
    fireEvent.click(screen.getByRole("button", { name: "Unknown" }));

    expect(onSelectState).toHaveBeenCalledWith("CA");
    expect(onSelectState).toHaveBeenNthCalledWith(2, "MO");
    expect(onSelectState).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Darker states have more results.")).not.toBeNull();
    expect(screen.getByText("12")).not.toBeNull();
  });

  it("falls back to geography names and zero-result labels when map metadata is missing", () => {
    const originalCalifornia = STATE_NAME_BY_CODE.CA ?? "California";

    delete STATE_NAME_BY_CODE.CA;

    try {
      render(<UsMapSurface stateDensity={[]} selectedState={undefined} onSelectState={vi.fn()} />);

      expect(screen.getByRole("button", { name: "Golden State, 0 results" })).not.toBeNull();
    } finally {
      STATE_NAME_BY_CODE.CA = originalCalifornia;
    }
  });
});
