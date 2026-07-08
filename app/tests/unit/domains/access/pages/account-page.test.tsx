// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  accountPageMocks as mocks,
  setQueryResults,
} from "../../../../helpers/access/account-page-test-bed";
import {
  createAtlasSessionFixture,
  createAtlasWorkspace,
} from "../../../../fixtures/access/sessions";

describe("AccountPage", () => {
  it("renders account data and supports passkey and API-key actions", async () => {
    const { AccountPage } = await import("@/domains/access/pages/workspace/account-page");

    render(<AccountPage />);
    await (mocks.useQuery.mock.calls[0]?.[0] as { queryFn: () => Promise<unknown> }).queryFn();
    await (mocks.useQuery.mock.calls[1]?.[0] as { queryFn: () => Promise<unknown> }).queryFn();
    await (mocks.useQuery.mock.calls[2]?.[0] as { queryFn: () => Promise<unknown> }).queryFn();

    expect(screen.getByRole("heading", { name: "Account" })).not.toBeNull();
    expect(screen.getAllByText("Willie").length).toBeGreaterThan(0);
    expect(screen.getAllByText("person@atlas.test").length).toBeGreaterThan(0);
    const settingsNav = screen.getByRole("navigation", { name: "Account settings" });
    expect(within(settingsNav).getByRole("link", { name: "Profile" }).getAttribute("href")).toBe(
      "#profile",
    );
    expect(within(settingsNav).getByRole("link", { name: "Security" }).getAttribute("href")).toBe(
      "#security",
    );
    expect(within(settingsNav).getByRole("link", { name: "Developer" }).getAttribute("href")).toBe(
      "#developer",
    );
    expect(within(settingsNav).getByRole("link", { name: "Scout" }).getAttribute("href")).toBe(
      "#scout",
    );
    expect(within(settingsNav).getByRole("link", { name: "Billing" }).getAttribute("href")).toBe(
      "#billing",
    );
    expect(screen.getByRole("heading", { name: "Profile" })).not.toBeNull();
    expect(screen.getByText("Personal details")).not.toBeNull();
    expect(screen.getByText("Workspace context")).not.toBeNull();
    expect(screen.getByText("Atlas Team")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Security" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Developer" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Scout" })).not.toBeNull();
    expect(screen.getByTestId("billing-section")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /Sign out/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Add passkey" }));
    fireEvent.click(screen.getByRole("button", { name: "Rename passkey" }));
    fireEvent.change(screen.getByDisplayValue("Desk key"), {
      target: { value: "Laptop key" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save passkey name" }));

    await waitFor(() => {
      expect(mocks.updatePasskey).toHaveBeenCalledWith({
        data: { id: "pk_123", name: "Laptop key" },
      });
      expect(screen.getByRole("button", { name: "Delete passkey" })).not.toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete passkey" }));

    fireEvent.change(screen.getByLabelText("Key name"), {
      target: { value: "Desktop script" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Create/i }));

    await waitFor(() => {
      expect(mocks.addPasskey).toHaveBeenCalledTimes(1);
      expect(mocks.updatePasskey).toHaveBeenCalledWith({
        data: { id: "pk_new", name: "iCloud Keychain" },
      });
      expect(mocks.createApiKey).toHaveBeenCalledWith({
        data: {
          name: "Desktop script",
          scopes: ["discovery:read"],
        },
      });
      expect(screen.getByText("atlas_secret_key")).not.toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: "Revoke API key" }));

    expect(mocks.deletePasskey).toHaveBeenCalledWith({
      data: { id: "pk_123" },
    });
    expect(mocks.signalUnknownPasskey).toHaveBeenCalledWith("pk_123");
    expect(mocks.deleteApiKey).toHaveBeenCalledWith({
      data: { keyId: "key_123" },
    });
    expect(screen.getByText("Willie's MacBook Pro")).not.toBeNull();

    await waitFor(() => {
      expect(screen.getByText("API key revoked.")).not.toBeNull();
    });
  });

  it("renders fallback labels, cancel flows, and disabled create state when scopes are cleared", async () => {
    mocks.useAtlasSession.mockReturnValue({
      data: createAtlasSessionFixture({
        user: {
          email: "person@atlas.test",
          name: "   ",
        },
        workspace: createAtlasWorkspace({
          resolvedCapabilities: {
            capabilities: [
              "research.run",
              "research.unlimited",
              "workspace.notes",
              "workspace.export",
              "api.keys",
              "api.mcp",
            ],
            limits: {
              research_runs_per_month: null,
              max_shortlists: null,
              max_shortlist_entries: null,
              max_api_keys: 1,
              api_requests_per_day: 1000,
              public_api_requests_per_hour: null,
              max_members: 1,
            },
          },
        }),
      }),
    });
    setQueryResults({
      apiKeys: [
        {
          createdAt: "2026-04-10T00:00:00.000Z",
          id: "key_fallback",
          name: null,
          prefix: null,
          scopes: undefined,
        },
      ],
      passkeys: [
        {
          backedUp: false,
          createdAt: "2026-04-10T00:00:00.000Z",
          deviceType: "cross-platform",
          id: "pk_fallback",
          name: null,
        },
      ],
    });
    const { AccountPage } = await import("@/domains/access/pages/workspace/account-page");

    render(<AccountPage />);

    expect(screen.getAllByText("person@atlas.test").length).toBeGreaterThan(0);
    expect(screen.getByText("Unnamed passkey")).not.toBeNull();
    expect(screen.getByText(/Hardware key/)).not.toBeNull();
    expect(screen.getByText("Untitled key")).not.toBeNull();
    expect(screen.getByText("No scopes")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Rename passkey" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel passkey rename" }));

    await waitFor(() => {
      expect(screen.getByText("Unnamed passkey")).not.toBeNull();
    });

    fireEvent.click(screen.getByRole("checkbox", { name: "discovery:read" }));

    const createButton = screen.getByRole("button", {
      name: /Create/i,
    });
    expect(createButton).toBeInstanceOf(HTMLButtonElement);

    if (!(createButton instanceof HTMLButtonElement)) {
      throw new TypeError("Expected Create button to be an HTMLButtonElement.");
    }

    expect(createButton.disabled).toBe(true);
  });

  it("renders empty and query-error states for passkeys and API keys", async () => {
    setQueryResults({
      apiKeys: [],
      apiKeysError: true,
      passkeys: [],
      passkeysError: true,
    });
    const { AccountPage } = await import("@/domains/access/pages/workspace/account-page");

    render(<AccountPage />);

    expect(screen.getByText("Could not load passkeys.")).not.toBeNull();
    expect(screen.getByText("Could not load API keys.")).not.toBeNull();
    expect(screen.getAllByText("Unavailable").length).toBeGreaterThanOrEqual(2);
  });

  it("surfaces passkey and API-key mutation failures", async () => {
    mocks.addPasskey.mockResolvedValue({
      error: {},
    });
    mocks.createApiKey.mockRejectedValue(new Error("create failed"));
    mocks.deleteApiKey.mockRejectedValue(new Error("delete failed"));
    mocks.deletePasskey.mockRejectedValue(new Error("delete failed"));
    mocks.updatePasskey.mockRejectedValue(new Error("rename failed"));
    const { AccountPage } = await import("@/domains/access/pages/workspace/account-page");

    render(<AccountPage />);

    fireEvent.click(screen.getByRole("button", { name: "Add passkey" }));
    await waitFor(() => {
      expect(
        screen.getByText("Atlas could not add that passkey. Please try again."),
      ).not.toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: "Rename passkey" }));
    fireEvent.change(screen.getByDisplayValue("Desk key"), {
      target: { value: "Broken key" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save passkey name" }));
    await waitFor(() => {
      expect(
        screen.getByText("Atlas could not rename that passkey. Please try again."),
      ).not.toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: "Cancel passkey rename" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete passkey" }));
    await waitFor(() => {
      expect(
        screen.getByText("Atlas could not remove that passkey. Please try again."),
      ).not.toBeNull();
    });

    fireEvent.change(screen.getByLabelText("Key name"), {
      target: { value: "Desktop script" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Create/i }));
    await waitFor(() => {
      expect(
        screen.getByText("Atlas could not create that API key. Please try again."),
      ).not.toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: "Revoke API key" }));
    await waitFor(() => {
      expect(
        screen.getByText("Atlas could not revoke that API key. Please try again."),
      ).not.toBeNull();
    });
  });
});
