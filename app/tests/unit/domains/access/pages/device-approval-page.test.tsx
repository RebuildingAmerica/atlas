// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeviceApprovalPage } from "@/domains/access/pages/auth/device-approval-page";

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
    render(<DeviceApprovalPage userCode="ABCD-EFGH" />);

    expect(screen.getByLabelText("Device code")).toHaveValue("ABCD-EFGH");
    expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("verifies an entered device code and approves Scout login", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse({ status: "pending", user_code: "ABCD-EFGH" }))
      .mockResolvedValueOnce(jsonResponse({ success: true }));

    render(<DeviceApprovalPage userCode="ABCD-EFGH" />);

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(
      await screen.findByText("Confirm this code before granting access."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText("Approve"));

    await waitFor(() => {
      expect(screen.getByText("Device approved.")).toBeInTheDocument();
    });
    expect(global.fetch).toHaveBeenNthCalledWith(1, "/api/auth/device?user_code=ABCD-EFGH", {
      credentials: "include",
    });
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      "/api/auth/device/approve",
      expect.objectContaining({
        body: JSON.stringify({ userCode: "ABCD-EFGH" }),
        credentials: "include",
        method: "POST",
      }),
    );
  });

  it("shows a plain error when the URL has no code", () => {
    render(<DeviceApprovalPage />);

    expect(screen.getByLabelText("Device code")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
