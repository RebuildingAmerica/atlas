// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AtlasBrandMark } from "@/platform/layout/atlas-brand-mark";
import { AuthBrandHeader, AuthBrandPanel } from "@/platform/layout/auth-brand-panel";

vi.mock("@/platform/layout/civic-map-panel", () => ({
  CivicMapPanel: () => <div data-testid="civic-map-panel" />,
}));

describe("AtlasBrandMark", () => {
  afterEach(() => {
    cleanup();
  });

  it("paints the pin glyph in the tile's text color so it follows theme tokens", () => {
    render(<AtlasBrandMark size="compact" />);

    const tile = screen.getByTestId("atlas-brand-mark");
    expect(tile).toHaveClass("bg-primary", "text-on-primary", "h-7", "w-7", "rounded-[0.85rem]");
    const glyph = tile.querySelector("svg");
    expect(glyph).toHaveAttribute("fill", "currentColor");
    expect(glyph).toHaveAttribute("aria-hidden", "true");
    expect(glyph).toHaveClass("h-5", "w-5");
  });

  it("keeps the larger tile proportions on the sign-in brand panel", () => {
    render(<AtlasBrandMark size="large" />);

    const tile = screen.getByTestId("atlas-brand-mark");
    expect(tile).toHaveClass("h-12", "w-12", "rounded-2xl");
    expect(tile.querySelector("svg")).toHaveClass("h-[2.125rem]", "w-[2.125rem]");
  });

  it("leaves the wordmark as the only text beside the mark on the auth panel and header", () => {
    render(
      <>
        <AuthBrandPanel />
        <AuthBrandHeader />
      </>,
    );

    const marks = screen.getAllByTestId("atlas-brand-mark");
    expect(marks).toHaveLength(2);
    expect(marks[0]).toHaveClass("h-12");
    expect(marks[1]).toHaveClass("h-7");
    for (const mark of marks) {
      expect(mark.textContent).toBe("");
      expect(mark.nextElementSibling).toHaveTextContent(/^Atlas$/);
    }
  });
});
