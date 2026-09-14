// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RouteErrorPanel } from "@/platform/routes/route-error-panel";
import { readRouterMocks } from "../../../helpers/router-harness";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

describe("RouteErrorPanel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    readRouterMocks().invalidate.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("recovers on its own, backing off between attempts, without showing internals", () => {
    render(
      <RouteErrorPanel
        error={new Error("Too many requests.")}
        info={{ componentStack: "" }}
        reset={vi.fn()}
      />,
    );

    expect(screen.getByText("This page didn’t load")).toBeInTheDocument();
    expect(screen.queryByText(/Too many requests/)).not.toBeInTheDocument();
    expect(screen.getByText("Trying again in 5 seconds.")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(readRouterMocks().invalidate).toHaveBeenCalledOnce();
    expect(screen.getByText("Trying again in 15 seconds.")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(15_000);
    });
    act(() => {
      vi.advanceTimersByTime(45_000);
    });
    expect(readRouterMocks().invalidate).toHaveBeenCalledTimes(3);
    expect(screen.getByText(/Give this page another try/)).toBeInTheDocument();
  });

  it("retries at once when asked", () => {
    const reset = vi.fn();
    render(
      <RouteErrorPanel error={new Error("boom")} info={{ componentStack: "" }} reset={reset} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Try again now/ }));

    expect(reset).toHaveBeenCalledOnce();
    expect(readRouterMocks().invalidate).toHaveBeenCalledOnce();
  });
});
