// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import {
  SchemeReader,
  createColorSchemeControl,
} from "@/../tests/helpers/catalog/color-scheme-harness";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useDeviceColorScheme", () => {
  it("reads and subscribes to the device dark-mode preference", () => {
    const control = createColorSchemeControl();
    control.install(false);

    const { unmount } = render(<SchemeReader />);

    expect(control.lastQuery()).toBe("(prefers-color-scheme: dark)");
    expect(control.listenerCount()).toBe(1);
    expect(screen.getByLabelText("Device color scheme")).toHaveTextContent("light");

    act(() => {
      control.emitChange(true);
    });

    expect(screen.getByLabelText("Device color scheme")).toHaveTextContent("dark");

    unmount();
    expect(control.listenerCount()).toBe(0);
  });

  it("renders light on the server, where no device preference is knowable", async () => {
    const { renderToString } = await import("react-dom/server");

    expect(renderToString(<SchemeReader />)).toContain(">light<");
  });

  it("falls back to light on a browser without matchMedia", () => {
    const original = window.matchMedia;
    Reflect.deleteProperty(window, "matchMedia");

    try {
      const { unmount } = render(<SchemeReader />);
      expect(screen.getByLabelText("Device color scheme")).toHaveTextContent("light");
      unmount();
    } finally {
      window.matchMedia = original;
    }
  });
});
