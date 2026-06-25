// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useReducedMotion } from "@/domains/catalog/hooks/use-reduced-motion";
import { createReducedMotionControl } from "../../../../helpers/catalog/reduced-motion-harness";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useReducedMotion", () => {
  it("reports false when the visitor has not asked to reduce motion", () => {
    const control = createReducedMotionControl();
    control.install(false);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
    expect(control.lastQuery()).toBe("(prefers-reduced-motion: reduce)");
  });

  it("reports true when the visitor prefers reduced motion at mount", () => {
    const control = createReducedMotionControl();
    control.install(true);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);
  });

  it("tracks a live change to the visitor's motion preference", () => {
    const control = createReducedMotionControl();
    control.install(false);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
    act(() => {
      control.emitChange(true);
    });
    expect(result.current).toBe(true);
  });

  it("stops listening once unmounted so a later change is ignored", () => {
    const control = createReducedMotionControl();
    control.install(false);
    const { result, unmount } = renderHook(() => useReducedMotion());
    unmount();
    expect(control.listenerCount()).toBe(0);
    act(() => {
      control.emitChange(true);
    });
    expect(result.current).toBe(false);
  });
});
