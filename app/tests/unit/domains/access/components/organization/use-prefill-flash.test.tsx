// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  flashClassName,
  usePrefillFlash,
} from "@/domains/access/components/organization/use-prefill-flash";

describe("usePrefillFlash", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts with an empty flashed set", () => {
    const { result } = renderHook(() => usePrefillFlash());
    expect(result.current.flashed.size).toBe(0);
  });

  it("flashes the given fields and clears them after 1.8 seconds", () => {
    const { result } = renderHook(() => usePrefillFlash());

    act(() => {
      result.current.flash(["issuer", "entryPoint"]);
    });

    expect(result.current.flashed.has("issuer")).toBe(true);
    expect(result.current.flashed.has("entryPoint")).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1800);
    });

    expect(result.current.flashed.size).toBe(0);
  });

  it("resets the timer when flash is called again", () => {
    const { result } = renderHook(() => usePrefillFlash());

    act(() => {
      result.current.flash(["a"]);
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    act(() => {
      result.current.flash(["b"]);
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current.flashed.has("b")).toBe(true);
    expect(result.current.flashed.has("a")).toBe(false);
  });
});

describe("flashClassName", () => {
  it("returns the emerald ring classes when the field is flashed", () => {
    const flashed = new Set(["entryPoint"]);
    expect(flashClassName(flashed, "entryPoint")).toContain("ring-emerald-300");
  });

  it("returns the baseline transition classes otherwise", () => {
    const flashed = new Set<string>();
    expect(flashClassName(flashed, "entryPoint")).toBe("transition-shadow rounded-2xl");
  });
});
