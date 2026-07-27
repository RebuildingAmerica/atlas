// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GridSurface, ListSurface } from "@/domains/catalog/components/browse/browse-surfaces";

describe("GridSurface", () => {
  it("names each state, counts its records, and reports which one is picked", async () => {
    const onSelectState = vi.fn();
    const user = userEvent.setup();
    render(
      <GridSurface
        onSelectState={onSelectState}
        selectedState="MS"
        states={[
          { count: 12, intensity: 0.8, state: "MS" },
          { count: 3, intensity: 0.1, state: "MO" },
        ]}
      />,
    );

    expect(screen.getByRole("button", { pressed: true })).toHaveTextContent("Mississippi");
    expect(screen.getByText("12 matching records")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Missouri/ }));
    expect(onSelectState).toHaveBeenCalledWith("MO");
  });

  it("shows the raw code for a place the state table does not name", () => {
    render(
      <GridSurface onSelectState={vi.fn()} states={[{ count: 1, intensity: 0.2, state: "ZZ" }]} />,
    );
    expect(screen.getByText("ZZ")).toBeInTheDocument();
  });
});

describe("ListSurface", () => {
  it("ranks states and hands the picked one back to the caller", async () => {
    const onSelectState = vi.fn();
    const user = userEvent.setup();
    render(
      <ListSurface
        onSelectState={onSelectState}
        selectedState="MS"
        states={[
          { count: 12, intensity: 0.8, state: "MS" },
          { count: 3, intensity: 0.1, state: "MO" },
        ]}
      />,
    );

    expect(screen.getByText("01")).toBeInTheDocument();
    expect(screen.getByText("02")).toBeInTheDocument();
    expect(screen.getByRole("button", { pressed: true })).toHaveTextContent("Mississippi");
    expect(screen.getByText("3 records")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Missouri/ }));
    expect(onSelectState).toHaveBeenCalledWith("MO");
  });

  it("shows the raw code for a place the state table does not name", () => {
    render(
      <ListSurface onSelectState={vi.fn()} states={[{ count: 1, intensity: 0.2, state: "ZZ" }]} />,
    );
    expect(screen.getAllByText("ZZ")).toHaveLength(2);
  });
});
