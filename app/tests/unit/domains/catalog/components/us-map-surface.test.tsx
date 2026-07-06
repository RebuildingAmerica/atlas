// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import type { KeyboardEvent, ReactNode } from "react";
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
    "aria-pressed": ariaPressed,
    onClick,
    onKeyDown,
    role,
    tabIndex,
  }: {
    "aria-label": string;
    "aria-pressed"?: boolean;
    onClick: () => void;
    onKeyDown?: (event: KeyboardEvent<SVGPathElement>) => void;
    role?: string;
    tabIndex?: number;
  }) => (
    <svg>
      <path
        aria-label={ariaLabel}
        aria-pressed={ariaPressed}
        data-testid={ariaLabel}
        onClick={onClick}
        onKeyDown={onKeyDown}
        role={role}
        tabIndex={tabIndex}
      />
    </svg>
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

    const california = screen.getByRole("button", { name: "California, 12 results" });
    const missouri = screen.getByRole("button", { name: "Missouri, 6 results" });
    const unknown = screen.getByLabelText("Unknown");

    expect(california).toHaveAttribute("aria-pressed", "true");
    expect(missouri).toHaveAttribute("aria-pressed", "false");
    expect(california).toHaveAttribute("tabindex", "0");
    expect(screen.queryByRole("button", { name: "Unknown" })).toBeNull();

    fireEvent.click(california);
    fireEvent.keyDown(missouri, { key: "Enter" });
    fireEvent.keyDown(missouri, { key: " " });
    fireEvent.click(unknown);

    expect(onSelectState).toHaveBeenCalledWith("CA");
    expect(onSelectState).toHaveBeenNthCalledWith(2, "MO");
    expect(onSelectState).toHaveBeenNthCalledWith(3, "MO");
    expect(onSelectState).toHaveBeenCalledTimes(3);
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
