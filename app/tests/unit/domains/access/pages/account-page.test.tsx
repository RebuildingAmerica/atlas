// @vitest-environment jsdom

import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  createAtlasSessionFixture,
  createAtlasWorkspace,
} from "../../../../fixtures/access/sessions";

const mocks = vi.hoisted(() => ({
  addPasskey: vi.fn(),
  createApiKey: vi.fn(),
  deleteApiKey: vi.fn(),
  deletePasskey: vi.fn(),
  listScoutDevices: vi.fn(),
  invalidateQueries: vi.fn(),
  revokeScoutDevice: vi.fn(),
  updatePasskey: vi.fn(),
  useAtlasSession: vi.fn(),
  useMutation: vi.fn(),
  useQuery: vi.fn(),
  useQueryClient: vi.fn(),
}));

vi.mock("lucide-react", () => {
  const makeIcon = (label: string) => () => <span>{label}</span>;

  return {
    Check: makeIcon("Check"),
    KeyRound: makeIcon("KeyRound"),
    MonitorUp: makeIcon("MonitorUp"),
    Pencil: makeIcon("Pencil"),
    Plus: makeIcon("Plus"),
    Trash2: makeIcon("Trash2"),
    X: makeIcon("X"),
  };
});

vi.mock("@/platform/layout/page-layout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/platform/ui/button", () => ({
  Button: ({
    ariaLabel,
    children,
    disabled,
    onClick,
    type = "button",
  }: {
    ariaLabel?: string;
    children: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
    type?: "button" | "submit" | "reset";
  }) => (
    <button type={type} aria-label={ariaLabel} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, className, to }: { children: ReactNode; className?: string; to: string }) => (
    <a className={className} href={to}>
      {children}
    </a>
  ),
}));

vi.mock("@/platform/ui/input", () => ({
  Input: ({
    label,
    onChange,
    placeholder,
    value,
  }: {
    label?: string;
    onChange?: (value: string) => void;
    placeholder?: string;
    value?: string;
  }) => (
    <label>
      {label || "input"}
      <input
        aria-label={label || "input"}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
      />
    </label>
  ),
}));

vi.mock("@tanstack/react-query", () => ({
  useMutation: mocks.useMutation,
  useQuery: mocks.useQuery,
  useQueryClient: mocks.useQueryClient,
}));

vi.mock("@/domains/access/client/auth-client", () => ({
  getAuthClient: () => ({
    passkey: {
      addPasskey: mocks.addPasskey,
    },
  }),
}));

vi.mock("@/domains/access/client/use-atlas-session", () => ({
  atlasSessionQueryKey: ["auth", "session"],
  useAtlasSession: mocks.useAtlasSession,
}));

vi.mock("@/domains/access/api-keys.functions", () => ({
  createApiKey: mocks.createApiKey,
  deleteApiKey: mocks.deleteApiKey,
  listApiKeys: vi.fn(),
}));

vi.mock("@/domains/access/passkeys.functions", () => ({
  deletePasskey: mocks.deletePasskey,
  listPasskeys: vi.fn(),
  updatePasskey: mocks.updatePasskey,
}));

vi.mock("@/domains/access/scout-devices.functions", () => ({
  listScoutDevices: mocks.listScoutDevices,
  revokeScoutDevice: mocks.revokeScoutDevice,
}));

vi.mock("@/domains/billing/components/workspace-billing-section", () => ({
  WorkspaceBillingSection: () => <div data-testid="billing-section">Billing</div>,
}));

afterEach(() => {
  cleanup();
});

describe("AccountPage", () => {
  const setQueryResults = ({
    apiKeys = [
      {
        createdAt: "2026-04-10T00:00:00.000Z",
        id: "key_123",
        name: "CLI key",
        prefix: "atlas_1234",
        scopes: ["discovery:read"],
      },
    ],
    apiKeysError = false,
    passkeys = [
      {
        backedUp: true,
        createdAt: "2026-04-10T00:00:00.000Z",
        deviceType: "platform",
        id: "pk_123",
        name: "Desk key",
      },
    ],
    passkeysError = false,
    scoutDevices = [
      {
        createdAt: "2026-07-04T16:00:00.000Z",
        defaultUploadTarget: "workspace",
        id: "worker-123",
        lastSeenAt: "2026-07-04T17:00:00.000Z",
        revokedAt: null,
        searchKeyConfigured: true,
        workerName: "Willie's MacBook Pro",
        workspaceId: "org-123",
      },
    ],
    scoutDevicesError = false,
  }: {
    apiKeys?: {
      createdAt: string;
      id: string;
      name?: string | null;
      prefix?: string | null;
      scopes?: string[];
    }[];
    apiKeysError?: boolean;
    passkeys?: {
      backedUp: boolean;
      createdAt: string;
      deviceType: string;
      id: string;
      name?: string | null;
    }[];
    passkeysError?: boolean;
    scoutDevices?: {
      createdAt: string;
      defaultUploadTarget: "public" | "workspace";
      id: string;
      lastSeenAt: string;
      revokedAt: string | null;
      searchKeyConfigured: boolean;
      workerName: string;
      workspaceId: string | null;
    }[];
    scoutDevicesError?: boolean;
  }) => {
    mocks.useQuery.mockImplementation(({ queryKey }: { queryKey: readonly string[] }) => {
      if (queryKey[1] === "passkeys") {
        return {
          data: passkeys,
          isError: passkeysError,
        };
      }

      if (queryKey[1] === "api-keys") {
        return {
          data: apiKeys,
          isError: apiKeysError,
        };
      }

      if (queryKey[1] === "scout-devices") {
        return {
          data: scoutDevices,
          isError: scoutDevicesError,
        };
      }

      throw new Error(`Unexpected query key: ${JSON.stringify(queryKey)}`);
    });
  };

  function isNewPasskeyRename(payload: unknown) {
    if (payload === null || typeof payload !== "object") {
      return false;
    }

    const payloadRecord = payload as Record<string, unknown>;
    const data = payloadRecord.data;
    if (data === null || typeof data !== "object") {
      return false;
    }

    const dataRecord = data as Record<string, unknown>;
    return dataRecord.id === "pk_new";
  }

  beforeEach(() => {
    vi.resetModules();
    mocks.addPasskey.mockReset();
    mocks.createApiKey.mockReset();
    mocks.deleteApiKey.mockReset();
    mocks.deletePasskey.mockReset();
    mocks.listScoutDevices.mockReset();
    mocks.invalidateQueries.mockReset();
    mocks.revokeScoutDevice.mockReset();
    mocks.updatePasskey.mockReset();
    mocks.useAtlasSession.mockReset();
    mocks.useMutation.mockReset();
    mocks.useQuery.mockReset();
    mocks.useQueryClient.mockReset();
    mocks.useQueryClient.mockReturnValue({
      invalidateQueries: mocks.invalidateQueries.mockResolvedValue(undefined),
    });
    mocks.useMutation.mockImplementation(
      (config: {
        mutationFn?: (input?: unknown) => Promise<unknown>;
        onError?: () => void;
        onSuccess?: (result?: unknown) => void | Promise<void>;
      }) => ({
        isPending: false,
        mutate: (input?: unknown) => {
          Promise.resolve(config.mutationFn?.(input))
            .then(async (result) => {
              await config.onSuccess?.(result);
            })
            .catch(() => {
              config.onError?.();
            });
        },
        mutateAsync: async (input?: unknown) => {
          try {
            const result = await config.mutationFn?.(input);
            await config.onSuccess?.(result);
            return result;
          } catch (error) {
            config.onError?.();
            throw error;
          }
        },
      }),
    );
    mocks.useAtlasSession.mockReturnValue({
      data: createAtlasSessionFixture({
        user: {
          email: "person@atlas.test",
          name: "Willie",
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
    setQueryResults({});
    mocks.addPasskey.mockResolvedValue({
      data: {
        aaguid: "fbfc3007-154e-4ecc-8c0b-6e020557d7bd",
        id: "pk_new",
      },
    });
    mocks.createApiKey.mockResolvedValue({
      key: "atlas_secret_key",
    });
    mocks.deleteApiKey.mockResolvedValue(undefined);
    mocks.deletePasskey.mockResolvedValue(undefined);
    mocks.revokeScoutDevice.mockResolvedValue(undefined);
    mocks.updatePasskey.mockResolvedValue(undefined);
  });

  it("renders account data and supports passkey and API-key actions", async () => {
    const { AccountPage } = await import("@/domains/access/pages/workspace/account-page");

    render(<AccountPage />);
    await (mocks.useQuery.mock.calls[0]?.[0] as { queryFn: () => Promise<unknown> }).queryFn();
    await (mocks.useQuery.mock.calls[1]?.[0] as { queryFn: () => Promise<unknown> }).queryFn();
    await (mocks.useQuery.mock.calls[2]?.[0] as { queryFn: () => Promise<unknown> }).queryFn();

    expect(screen.getByRole("heading", { name: "Account" })).not.toBeNull();
    expect(screen.getByText("Willie")).not.toBeNull();
    expect(screen.getByText("person@atlas.test")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Workspace" })).not.toBeNull();
    expect(screen.getByText("Atlas Team")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Security" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Developer access" })).not.toBeNull();
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

  it("renders gracefully when the session data is unavailable", async () => {
    mocks.useAtlasSession.mockReturnValue({ data: undefined });
    setQueryResults({ apiKeys: [], passkeys: [], scoutDevices: [] });
    const { AccountPage } = await import("@/domains/access/pages/workspace/account-page");

    render(<AccountPage />);
    expect(screen.getByRole("heading", { name: "Account" })).not.toBeNull();
  });

  it("hides the API-key panel when capabilities omit api.keys", async () => {
    mocks.useAtlasSession.mockReturnValue({
      data: createAtlasSessionFixture({
        workspace: createAtlasWorkspace({
          resolvedCapabilities: {
            capabilities: ["research.run"],
            limits: {
              research_runs_per_month: 2,
              max_shortlists: 1,
              max_shortlist_entries: 25,
              max_api_keys: 0,
              api_requests_per_day: 0,
              public_api_requests_per_hour: 100,
              max_members: 1,
            },
          },
        }),
      }),
    });
    setQueryResults({ apiKeys: [], passkeys: [], scoutDevices: [] });
    const { AccountPage } = await import("@/domains/access/pages/workspace/account-page");

    render(<AccountPage />);
    expect(screen.queryByLabelText("Key name")).toBeNull();
    expect(screen.queryByText("Create an API key")).toBeNull();
  });

  it("hides security, developer access, and billing when running in local mode", async () => {
    mocks.useAtlasSession.mockReturnValue({
      data: createAtlasSessionFixture({
        isLocal: true,
        workspace: createAtlasWorkspace({
          resolvedCapabilities: {
            capabilities: ["research.run", "api.keys", "api.mcp"],
            limits: {
              research_runs_per_month: 2,
              max_shortlists: 1,
              max_shortlist_entries: 25,
              max_api_keys: 1,
              api_requests_per_day: 1000,
              public_api_requests_per_hour: 100,
              max_members: 1,
            },
          },
        }),
      }),
    });
    setQueryResults({ apiKeys: [], passkeys: [] });
    const { AccountPage } = await import("@/domains/access/pages/workspace/account-page");

    render(<AccountPage />);
    expect(screen.queryByText("Billing")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Developer access" })).toBeNull();
    expect(screen.queryByLabelText("Key name")).toBeNull();
    expect(screen.queryByRole("button", { name: "Add passkey" })).toBeNull();
  });

  it("treats a non-string key field on the createApiKey response as a missing secret", async () => {
    mocks.createApiKey.mockResolvedValue({ key: 12345 });
    const { AccountPage } = await import("@/domains/access/pages/workspace/account-page");

    render(<AccountPage />);

    fireEvent.change(screen.getByLabelText("Key name"), {
      target: { value: "Desktop script" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Create/i }));

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
    fireEvent.click(screen.getByRole("button", { name: /Create/i }));

    await waitFor(() => {
      expect(mocks.createApiKey).toHaveBeenCalled();
    });
    // No secret rendered because the response could not be parsed.
    expect(screen.queryByText("atlas_secret_key")).toBeNull();
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
    fireEvent.click(screen.getByRole("button", { name: /Create/i }));

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
