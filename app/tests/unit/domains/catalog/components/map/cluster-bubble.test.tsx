// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ClusterBubble } from "@/domains/catalog/components/map/cluster-bubble";

afterEach(cleanup);

describe("ClusterBubble", () => {
  it("labels the bubble with its actor count and an accessible name", () => {
    render(<ClusterBubble pointCount={14} onExpand={vi.fn()} />);
    const button = screen.getByRole("button", { name: "14 civic actors here — zoom in" });
    expect(button.textContent).toContain("14");
  });

  it("names the smallest possible cluster of two actors", () => {
    render(<ClusterBubble pointCount={2} onExpand={vi.fn()} />);
    expect(screen.getByRole("button", { name: "2 civic actors here — zoom in" })).toBeTruthy();
  });

  it("calls onExpand when clicked", () => {
    const onExpand = vi.fn();
    render(<ClusterBubble pointCount={9} onExpand={onExpand} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onExpand).toHaveBeenCalledOnce();
  });

  it("reveals by growing real dimensions from a smaller size into its resting diameter", () => {
    vi.useFakeTimers();
    try {
      render(<ClusterBubble pointCount={20} onExpand={vi.fn()} />);
      const button = screen.getByRole("button");
      const startWidth = parseFloat(button.style.width);
      act(() => {
        vi.runAllTimers();
      });
      const restWidth = parseFloat(button.style.width);
      expect(restWidth).toBeGreaterThan(startWidth);
      // The reveal changes real width/height — never a CSS scale transform.
      expect(button.style.transform).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips the grow-in when the visitor prefers reduced motion", () => {
    render(<ClusterBubble pointCount={20} onExpand={vi.fn()} reducedMotion />);
    const button = screen.getByRole("button");
    // Already at rest: no pending grow, full diameter from the first frame.
    expect(parseFloat(button.style.width)).toBeGreaterThan(0);
    expect(button.style.transform).toBe("");
  });
});
