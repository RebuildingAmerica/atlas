// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MapLegend } from "@/domains/catalog/components/map/map-legend";

afterEach(cleanup);

describe("MapLegend", () => {
  it("opens collapsed and expands to reveal the dot language on demand", () => {
    render(<MapLegend />);

    const toggle = screen.getByRole("button", { name: /legend/i });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Verified by Atlas or the subject")).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Verified by Atlas or the subject")).toBeTruthy();
  });

  it("collapses again when toggled a second time", () => {
    render(<MapLegend />);
    const toggle = screen.getByRole("button", { name: /legend/i });
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Verified by Atlas or the subject")).toBeNull();
  });

  it("names the trust tiers honestly, including the quiet unverified dot", () => {
    render(<MapLegend />);
    fireEvent.click(screen.getByRole("button", { name: /legend/i }));
    expect(screen.getByText("Corroborated across sources")).toBeTruthy();
    expect(screen.getByText("Unverified — shown quietly")).toBeTruthy();
  });
});
