// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  accountPageMocks as mocks,
  isNewPasskeyRename,
} from "../../../../helpers/access/account-page-test-bed";

describe("AccountPage", () => {
  it("treats a non-string key field on the createApiKey response as a missing secret", async () => {
    mocks.createApiKey.mockResolvedValue({ key: 12345 });
    const { AccountPage } = await import("@/domains/access/pages/workspace/account-page");

    render(<AccountPage />);

    fireEvent.change(screen.getByLabelText("Key name"), {
      target: { value: "Desktop script" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create API key" }));

    await waitFor(() => {
      expect(mocks.createApiKey).toHaveBeenCalled();
    });
    expect(screen.queryByText(/atlas_secret_key/)).toBeNull();
  });

  it("treats a non-object createApiKey response as a missing secret", async () => {
    mocks.createApiKey.mockResolvedValue(null);
    const { AccountPage } = await import("@/domains/access/pages/workspace/account-page");

    render(<AccountPage />);

    fireEvent.change(screen.getByLabelText("Key name"), {
      target: { value: "Desktop script" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create API key" }));

    await waitFor(() => {
      expect(mocks.createApiKey).toHaveBeenCalled();
    });
    // No secret rendered because the response could not be parsed.
    expect(screen.queryByText("atlas_secret_key")).toBeNull();
  });

  it("shows valid MCP billing completion", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          elicitation_id: "eli_123",
          status: "completed",
          target_flow: "billing_settings",
        }),
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "/account?mcpElicitationId=eli_123");
    const { AccountPage } = await import("@/domains/access/pages/workspace/account-page");

    render(<AccountPage />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/mcp/elicitations/eli_123/complete", {
        method: "POST",
      });
      expect(
        screen.getByText("You can return to your assistant to continue billing setup."),
      ).not.toBeNull();
    });
  });

  it("shows valid MCP API key completion", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          elicitation_id: "eli_key",
          status: "completed",
          target_flow: "api_key_settings",
        }),
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "/account?mcpElicitationId=eli_key");
    const { AccountPage } = await import("@/domains/access/pages/workspace/account-page");

    render(<AccountPage />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/mcp/elicitations/eli_key/complete", {
        method: "POST",
      });
      expect(
        screen.getByText("You can return to your assistant to continue API key setup."),
      ).not.toBeNull();
    });
  });

  it("shows generic MCP account completion", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          elicitation_id: "eli_account",
          status: "completed",
          target_flow: "new_account_flow",
        }),
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "/account?mcpElicitationId=eli_account");
    const { AccountPage } = await import("@/domains/access/pages/workspace/account-page");

    render(<AccountPage />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/mcp/elicitations/eli_account/complete", {
        method: "POST",
      });
      expect(
        screen.getByText("You can return to your assistant to continue from account settings."),
      ).not.toBeNull();
    });
  });

  it("ignores malformed MCP billing completion", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: "ignored" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "/account?mcpElicitationId=eli_bad");
    const { AccountPage } = await import("@/domains/access/pages/workspace/account-page");

    render(<AccountPage />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/mcp/elicitations/eli_bad/complete", {
        method: "POST",
      });
      expect(
        screen.queryByText("You can return to your assistant to continue billing setup."),
      ).toBeNull();
    });
  });

  it("hides failed MCP account completion", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ detail: "MCP elicitation not found." }),
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "/account?mcpElicitationId=eli_missing");
    const { AccountPage } = await import("@/domains/access/pages/workspace/account-page");

    render(<AccountPage />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/mcp/elicitations/eli_missing/complete", {
        method: "POST",
      });
    });
    expect(screen.queryByText("MCP elicitation not found.")).toBeNull();
    expect(screen.queryByText(/You can return to your assistant/)).toBeNull();
  });

  it("handles passkey and API-key creation responses that omit generated data", async () => {
    mocks.addPasskey.mockResolvedValue({});
    mocks.createApiKey.mockResolvedValue({});
    const { AccountPage } = await import("@/domains/access/pages/workspace/account-page");

    render(<AccountPage />);

    fireEvent.click(screen.getByRole("checkbox", { name: "discovery:write" }));
    fireEvent.click(screen.getByRole("button", { name: "Add passkey" }));

    await waitFor(() => {
      const createdPasskeyRename = mocks.updatePasskey.mock.calls.some(([payload]) =>
        isNewPasskeyRename(payload),
      );

      expect(createdPasskeyRename).toBe(false);
      expect(screen.getByText("Passkey added to your Atlas account.")).not.toBeNull();
    });

    fireEvent.change(screen.getByLabelText("Key name"), {
      target: { value: "Desktop script" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create API key" }));

    await waitFor(() => {
      expect(mocks.createApiKey).toHaveBeenCalledWith({
        data: {
          name: "Desktop script",
          scopes: ["discovery:read", "discovery:write"],
        },
      });
      expect(
        screen.getByText(
          "API key created. Copy it now, because Atlas will only show it once. Activation can take a few seconds.",
        ),
      ).not.toBeNull();
    });
    expect(screen.queryByText("New API key")).toBeNull();
  });
});
