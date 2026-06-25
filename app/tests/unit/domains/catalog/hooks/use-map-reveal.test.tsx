// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import {
  MAP_REVEAL_SESSION_KEY,
  REVEAL_BASEMAP_FADE_MS,
  useMapReveal,
} from "@/domains/catalog/hooks/use-map-reveal";

beforeEach(() => {
  window.sessionStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("useMapReveal", () => {
  it("plays the reveal once on first visit, holding the chrome until the basemap settles", () => {
    const { result } = renderHook(() => useMapReveal());
    expect(result.current.playing).toBe(true);
    expect(result.current.chromeRevealed).toBe(false);
    act(() => {
      vi.advanceTimersByTime(REVEAL_BASEMAP_FADE_MS);
    });
    expect(result.current.chromeRevealed).toBe(true);
  });

  it("records that the reveal has played so a later mount this session skips it", () => {
    const first = renderHook(() => useMapReveal());
    act(() => {
      vi.runAllTimers();
    });
    first.unmount();
    expect(window.sessionStorage.getItem(MAP_REVEAL_SESSION_KEY)).toBe("1");

    const second = renderHook(() => useMapReveal());
    expect(second.result.current.playing).toBe(false);
    expect(second.result.current.chromeRevealed).toBe(true);
  });

  it("shows everything at once for visitors who prefer reduced motion", () => {
    const { result } = renderHook(() => useMapReveal({ reducedMotion: true }));
    expect(result.current.playing).toBe(false);
    expect(result.current.chromeRevealed).toBe(true);
    expect(window.sessionStorage.getItem(MAP_REVEAL_SESSION_KEY)).toBe("1");
  });

  it("clears its pending timer on unmount", () => {
    const clearSpy = vi.spyOn(window, "clearTimeout");
    const { unmount } = renderHook(() => useMapReveal());
    unmount();
    expect(clearSpy).toHaveBeenCalled();
  });
});
