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

  it("recovers from an outage on its own, backing off between attempts", () => {
    const rateLimited = Object.assign(new Error("Too many requests."), { status: 429 });
    render(<RouteErrorPanel error={rateLimited} info={{ componentStack: "" }} reset={vi.fn()} />);

    expect(screen.getByText("Atlas is busy right now")).toBeInTheDocument();
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

  it("never shows a bug's internals, and retries only when asked", () => {
    const reset = vi.fn();
    render(
      <RouteErrorPanel
        error={new TypeError("x is not a function")}
        info={{ componentStack: "" }}
        reset={reset}
      />,
    );

    expect(screen.getByText("This page hit a problem")).toBeInTheDocument();
    expect(screen.queryByText(/not a function/)).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(readRouterMocks().invalidate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Try again now/ }));
    expect(reset).toHaveBeenCalledOnce();
    expect(readRouterMocks().invalidate).toHaveBeenCalledOnce();
  });
});
