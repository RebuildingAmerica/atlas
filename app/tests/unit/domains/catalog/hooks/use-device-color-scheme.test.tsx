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
});
