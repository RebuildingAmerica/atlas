// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DeviceApprovalCompletePage,
  DeviceApprovalPage,
} from "@/domains/access/pages/auth/device-approval-page";
import { normalizeDeviceUserCode } from "@rebuildingamerica/atlas-access/device-code";
import {
  deviceAuthPath,
  deviceResultPath,
} from "@rebuildingamerica/atlas-access/device-auth-paths";

describe("DeviceApprovalPage", () => {
  function jsonResponse(payload: object): Response {
    return new Response(JSON.stringify(payload), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  }

  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation(vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("prepopulates the complete-uri code without verifying it automatically", () => {
    render(<DeviceApprovalPage userCode="ABCDEFGH" />);

    expect(screen.getByRole("textbox", { name: "Device code" })).toHaveValue("ABCD-EFGH");
    expect(screen.getByRole("button", { name: "Approve device" })).toBeInTheDocument();
    expect(screen.queryByText(/Scout/)).not.toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("approves an entered device code and redirects to the completion page", async () => {
    const redirect = vi.fn();
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        jsonResponse({
          status: "pending",
          user_code: "ABCD-EFGH",
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ success: true }));

    render(<DeviceApprovalPage redirect={redirect} userCode="ABCDEFGH" />);

    fireEvent.click(screen.getByRole("button", { name: "Approve device" }));

    await waitFor(() => {
      expect(redirect).toHaveBeenCalledWith(deviceAuthPath("approved"));
    });
    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      `${deviceAuthPath("status")}?user_code=ABCD-EFGH`,
      {
        credentials: "include",
      },
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      deviceAuthPath("approve"),
      expect.objectContaining({
        body: JSON.stringify({ userCode: "ABCD-EFGH" }),
        credentials: "include",
        method: "POST",
      }),
    );
  });

  it("redirects to the completion state when the code was already approved", async () => {
    const redirect = vi.fn();
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({
        status: "approved",
        user_code: "ABCD-EFGH",
      }),
    );

    render(<DeviceApprovalPage redirect={redirect} userCode="ABCDEFGH" />);

    fireEvent.click(screen.getByRole("button", { name: "Approve device" }));

    await waitFor(() => {
      expect(redirect).toHaveBeenCalledWith(deviceAuthPath("approved"));
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("redirects to the failure state when the device code cannot be approved", async () => {
    const redirect = vi.fn();
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(null, { status: 404 }));

    render(<DeviceApprovalPage redirect={redirect} userCode="ABCDEFGH" />);

    fireEvent.click(screen.getByRole("button", { name: "Approve device" }));

    await waitFor(() => {
      expect(redirect).toHaveBeenCalledWith(deviceResultPath("failed"));
    });
  });

  it("denies an entered device code and redirects to the failure state", async () => {
    const redirect = vi.fn();
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        jsonResponse({
          status: "pending",
          user_code: "ABCD-EFGH",
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ success: true }));

    render(<DeviceApprovalPage redirect={redirect} userCode="ABCDEFGH" />);

    fireEvent.click(screen.getByRole("button", { name: "Deny device" }));

    await waitFor(() => {
      expect(redirect).toHaveBeenCalledWith(deviceResultPath("denied"));
    });
    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      `${deviceAuthPath("status")}?user_code=ABCD-EFGH`,
      {
        credentials: "include",
      },
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      deviceAuthPath("deny"),
      expect.objectContaining({
        body: JSON.stringify({ userCode: "ABCD-EFGH" }),
        credentials: "include",
        method: "POST",
      }),
    );
  });

  it("renders the redirected failure state", () => {
    render(<DeviceApprovalPage status="failed" />);

    expect(screen.getByRole("heading", { name: "Device approval failed" })).toBeInTheDocument();
    expect(screen.getByText("Device could not be approved.")).toBeInTheDocument();
  });

  it("renders a finished browser completion state", () => {
    render(<DeviceApprovalCompletePage />);

    expect(screen.getByRole("heading", { name: "Device approved" })).toBeInTheDocument();
    expect(screen.getByText("You're done in the browser.")).toBeInTheDocument();
    expect(screen.getByText("You can close this tab.")).toBeInTheDocument();
  });

  it("shows a plain error when the URL has no code", () => {
    render(<DeviceApprovalPage />);

    expect(screen.getByRole("textbox", { name: "Device code" })).toHaveValue("");
    expect(screen.getByRole("button", { name: "Approve device" })).toBeDisabled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("normalizes typed device codes for easier comparison", () => {
    render(<DeviceApprovalPage />);

    fireEvent.change(screen.getByRole("textbox", { name: "Device code" }), {
      target: { value: "abcd efgh" },
    });

    expect(screen.getByRole("textbox", { name: "Device code" })).toHaveValue("ABCD-EFGH");
  });

  it("normalizes punctuation and lowercase codes through the shared helper", () => {
    expect(normalizeDeviceUserCode(" abcd - efgh!! ")).toBe("ABCD-EFGH");
  });
});
