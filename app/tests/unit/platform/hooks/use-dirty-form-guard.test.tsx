// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useDirtyFormGuard } from "@/platform/hooks/use-dirty-form-guard";

describe("useDirtyFormGuard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a beforeunload listener while the form is dirty", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() => {
      useDirtyFormGuard(true);
    });
    expect(addSpy).toHaveBeenCalledWith("beforeunload", expect.any(Function));
    unmount();
    expect(removeSpy).toHaveBeenCalledWith("beforeunload", expect.any(Function));
  });

  it("does not register a listener when the form is clean", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    renderHook(() => {
      useDirtyFormGuard(false);
    });
    const beforeunloadCalls = addSpy.mock.calls.filter((call) => call[0] === "beforeunload");
    expect(beforeunloadCalls).toHaveLength(0);
  });

  it("calls preventDefault on beforeunload to surface the browser prompt", () => {
    renderHook(() => {
      useDirtyFormGuard(true);
    });
    const event = new Event("beforeunload", { cancelable: true });
    Object.defineProperty(event, "returnValue", { writable: true, value: "" });
    const preventDefault = vi.spyOn(event, "preventDefault");
    window.dispatchEvent(event);
    expect(preventDefault).toHaveBeenCalled();
  });
});
