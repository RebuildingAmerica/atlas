import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { WidgetStatus } from "./widget-status";

afterEach(() => {
  cleanup();
});

describe("WidgetStatus", () => {
  it("logs the real error and shows the safe generic message when state.error is set", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const error = new Error("connection handshake failed");

    render(
      <WidgetStatus
        state={{ data: null, error }}
        errorMessage="Something went wrong loading this widget."
      >
        {() => <span>never rendered</span>}
      </WidgetStatus>,
    );

    expect(
      screen.getByText("Something went wrong loading this widget."),
    ).toBeInTheDocument();
    expect(screen.queryByText("never rendered")).not.toBeInTheDocument();
    expect(consoleError).toHaveBeenCalledWith(error);

    consoleError.mockRestore();
  });

  it("shows a loading placeholder while data is null and there is no error", () => {
    render(
      <WidgetStatus
        state={{ data: null, error: null }}
        errorMessage="Something went wrong loading this widget."
      >
        {() => <span>never rendered</span>}
      </WidgetStatus>,
    );

    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(screen.queryByText("never rendered")).not.toBeInTheDocument();
  });

  it("renders children with the narrowed, non-null data once present", () => {
    render(
      <WidgetStatus
        state={{ data: "ready", error: null }}
        errorMessage="Something went wrong loading this widget."
      >
        {(data) => <span>{data}</span>}
      </WidgetStatus>,
    );

    expect(screen.getByText("ready")).toBeInTheDocument();
  });
});
