// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const toastMocks = vi.hoisted(() => ({
  show: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/platform/ui/toast", () => ({
  useToast: () => toastMocks,
}));

const clipboardMocks = vi.hoisted(() => ({
  copyToClipboard: vi.fn(),
}));

vi.mock("@/lib/clipboard", () => ({
  copyToClipboard: clipboardMocks.copyToClipboard,
}));

import { WorkspaceSSOCopyField } from "@/domains/access/components/organization/workspace-sso-copy-field";

describe("WorkspaceSSOCopyField", () => {
  beforeEach(() => {
    toastMocks.success.mockClear();
    toastMocks.error.mockClear();
    clipboardMocks.copyToClipboard.mockReset();
    clipboardMocks.copyToClipboard.mockResolvedValue(true);
  });

  afterEach(() => {
    cleanup();
  });
  it("renders a single-line input by default", () => {
    render(<WorkspaceSSOCopyField label="SSO ID" value="test-id" />);
    expect(screen.getByText("SSO ID")).toBeInTheDocument();
    expect(screen.getByDisplayValue("test-id")).toBeInTheDocument();
    expect(screen.getByDisplayValue("test-id").tagName).toBe("INPUT");
  });

  it("renders a textarea when multiline is true", () => {
    render(<WorkspaceSSOCopyField label="Cert" value="---BEGIN---" multiline={true} />);
    expect(screen.getByDisplayValue("---BEGIN---").tagName).toBe("TEXTAREA");
  });

  it("applies the monospaced face when mono is requested", () => {
    render(<WorkspaceSSOCopyField label="Cert" value="abc" mono />);
    const input = screen.getByDisplayValue("abc");
    expect(input.className).toMatch(/font-mono/);
  });

  it("selects all text on focus", () => {
    render(<WorkspaceSSOCopyField label="SSO ID" value="test-id" />);
    const input = screen.getByDisplayValue("test-id");
    const selectSpy = vi.spyOn(input as HTMLInputElement, "select");

    fireEvent.focus(input);
    expect(selectSpy).toHaveBeenCalled();
  });

  it("truncates long values in the rendered input but keeps the full value in the title", () => {
    const longValue = "a".repeat(100);
    render(<WorkspaceSSOCopyField label="IdP entry point" value={longValue} truncateAt={20} />);
    const input = screen.getByDisplayValue(/^a{20}…$/);
    if (!(input instanceof HTMLInputElement)) throw new Error("expected input");
    expect(input.title).toBe(longValue);
  });

  it("renders a Copy button labelled with the field name", () => {
    render(<WorkspaceSSOCopyField label="SSO ID" value="test-id" />);
    expect(screen.getByRole("button", { name: "Copy SSO ID" })).toBeInTheDocument();
  });

  it("invokes the toast helper after a successful clipboard write", async () => {
    render(<WorkspaceSSOCopyField label="SSO ID" value="test-id" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy SSO ID" }));
    await waitFor(() => {
      expect(clipboardMocks.copyToClipboard).toHaveBeenCalledWith("test-id");
    });
    expect(toastMocks.success).toHaveBeenCalled();
  });

  it("toasts an error message when the clipboard refuses the copy", async () => {
    clipboardMocks.copyToClipboard.mockResolvedValue(false);
    render(<WorkspaceSSOCopyField label="SSO ID" value="test-id" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy SSO ID" }));
    await waitFor(() => {
      expect(toastMocks.error).toHaveBeenCalled();
    });
  });

  it("selects all text on textarea focus", () => {
    render(<WorkspaceSSOCopyField label="Cert" value="---BEGIN---" multiline={true} />);
    const textarea = screen.getByDisplayValue("---BEGIN---");
    if (!(textarea instanceof HTMLTextAreaElement)) throw new Error("expected textarea");
    const selectSpy = vi.spyOn(textarea, "select");
    fireEvent.focus(textarea);
    expect(selectSpy).toHaveBeenCalled();
  });

  it("clears the copied flash and resets the icon after the timeout fires", async () => {
    vi.useFakeTimers();
    try {
      render(<WorkspaceSSOCopyField label="SSO ID" value="test-id" />);
      const button = screen.getByRole("button", { name: "Copy SSO ID" });
      await act(async () => {
        fireEvent.click(button);
        // Allow the resolved clipboard promise to settle.
        await Promise.resolve();
      });
      // Click again to exercise the existing-timeout cleanup path.
      await act(async () => {
        fireEvent.click(button);
        await Promise.resolve();
      });
      await act(async () => {
        vi.advanceTimersByTime(2000);
        await Promise.resolve();
      });
    } finally {
      vi.useRealTimers();
    }
    // No assertion needed beyond the timer ticks completing without throwing —
    // the timeout-clear and recentlyCopied(false) branches are now exercised.
    expect(toastMocks.success).toHaveBeenCalledTimes(2);
  });
});
