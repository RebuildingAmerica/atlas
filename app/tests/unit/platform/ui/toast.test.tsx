// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider, useToast } from "@/platform/ui/toast";

describe("ToastProvider", () => {
  function ToastButtons() {
    const { show, success, error } = useToast();
    return (
      <div>
        <button
          type="button"
          onClick={() => {
            show("Plain notice");
          }}
        >
          Show
        </button>
        <button
          type="button"
          onClick={() => {
            success("Saved");
          }}
        >
          Success
        </button>
        <button
          type="button"
          onClick={() => {
            error("Failed");
          }}
        >
          Error
        </button>
      </div>
    );
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("shows a toast that auto-dismisses after the configured duration", () => {
    render(
      <ToastProvider>
        <ToastButtons />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByText("Show"));
    expect(screen.getByText("Plain notice")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(4_000);
    });

    expect(screen.queryByText("Plain notice")).not.toBeInTheDocument();
  });

  it("renders error toasts with role=alert and success toasts with role=status", () => {
    render(
      <ToastProvider>
        <ToastButtons />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByText("Error"));
    fireEvent.click(screen.getByText("Success"));

    expect(screen.getByRole("alert")).toHaveTextContent("Failed");
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
  });

  it("dismisses on the Dismiss button", () => {
    render(
      <ToastProvider>
        <ToastButtons />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByText("Show"));
    expect(screen.getByText("Plain notice")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Dismiss"));
    expect(screen.queryByText("Plain notice")).not.toBeInTheDocument();
  });

  it("throws a clear error when used without a provider", () => {
    function BareTrigger() {
      useToast();
      return null;
    }

    expect(() => render(<BareTrigger />)).toThrow(/ToastProvider/);
  });
});
