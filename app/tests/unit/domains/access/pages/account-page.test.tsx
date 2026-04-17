// @vitest-environment jsdom

import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createAtlasSessionFixture } from "../../../../fixtures/access/sessions";

const mocks = vi.hoisted(() => ({
  addPasskey: vi.fn(),
  createApiKey: vi.fn(),
  deleteApiKey: vi.fn(),
  deletePasskey: vi.fn(),
  invalidateQueries: vi.fn(),
  signOut: vi.fn(),
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
    LogOut: makeIcon("LogOut"),
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
    children,
    disabled,
    onClick,
    type = "button",
  }: {
    children: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
    type?: "button" | "submit" | "reset";
  }) => (
    <button type={type} disabled={disabled} onClick={onClick}>
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
    signOut: mocks.signOut,
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

afterEach(() => {
  cleanup();
});

describe("AccountPage", () => {
  const originalWindow = globalThis.window;
  let assignMock: ReturnType<typeof vi.fn>;
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
    mocks.invalidateQueries.mockReset();
    mocks.signOut.mockReset();
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
      data: createAtlasSessionFixture(),
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
    mocks.signOut.mockResolvedValue(undefined);
    mocks.updatePasskey.mockResolvedValue(undefined);
    assignMock = vi.fn();
    const testWindow = Object.create(originalWindow) as Window & typeof globalThis;
    Object.defineProperty(testWindow, "location", {
      configurable: true,
      value: { assign: assignMock },
    });
    vi.stubGlobal("window", testWindow);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders account resources and supports passkey, API-key, and sign-out actions", async () => {
    const { AccountPage } = await import("@/domains/access/pages/account-page");

    render(<AccountPage />);
    await (mocks.useQuery.mock.calls[0]?.[0] as { queryFn: () => Promise<unknown> }).queryFn();
    await (mocks.useQuery.mock.calls[1]?.[0] as { queryFn: () => Promise<unknown> }).queryFn();

    fireEvent.click(screen.getByRole("button", { name: /Add passkey/i }));
    fireEvent.click(screen.getByRole("button", { name: /Pencil/i }));
    fireEvent.change(screen.getByDisplayValue("Desk key"), {
      target: { value: "Laptop key" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Check/i }));

    await waitFor(() => {
      expect(mocks.updatePasskey).toHaveBeenCalledWith({
        data: { id: "pk_123", name: "Laptop key" },
      });
      expect(screen.getByRole("button", { name: /Trash2/i })).not.toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: /Trash2/i }));

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

    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    fireEvent.click(screen.getByRole("button", { name: /Sign out/i }));

    expect(mocks.deletePasskey).toHaveBeenCalledWith({
      data: { id: "pk_123" },
    });
    expect(mocks.deleteApiKey).toHaveBeenCalledWith({
      data: { keyId: "key_123" },
    });

    await waitFor(() => {
      expect(mocks.signOut).toHaveBeenCalledTimes(1);
      expect(assignMock).toHaveBeenCalledWith("/");
      expect(screen.getByText("API key revoked.")).not.toBeNull();
    });
  });

  it("renders fallback labels, cancel flows, and disabled create state when scopes are cleared", async () => {
    mocks.useAtlasSession.mockReturnValue({
      data: createAtlasSessionFixture({
        user: {
          name: "   ",
        },
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
    const { AccountPage } = await import("@/domains/access/pages/account-page");

    render(<AccountPage />);

    expect(screen.getByText("Atlas Operator")).not.toBeNull();
    expect(screen.getByText("Unnamed passkey")).not.toBeNull();
    expect(screen.getByText(/Hardware key/)).not.toBeNull();
    expect(screen.getByText("Untitled key")).not.toBeNull();
    expect(screen.getByText("No scopes")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Pencil/i }));
    fireEvent.click(screen.getByRole("button", { name: /X/i }));

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
    const { AccountPage } = await import("@/domains/access/pages/account-page");

    render(<AccountPage />);

    expect(screen.getByText("Atlas could not load your passkeys right now.")).not.toBeNull();
    expect(screen.getByText("No passkeys yet. Add one above for faster sign-in.")).not.toBeNull();
    expect(screen.getByText("Atlas could not load your API keys right now.")).not.toBeNull();
    expect(
      screen.getByText("No API keys yet. Create one for scripts or CLI access."),
    ).not.toBeNull();
  });

  it("surfaces passkey and API-key mutation failures", async () => {
    mocks.addPasskey.mockResolvedValue({
      error: {},
    });
    mocks.createApiKey.mockRejectedValue(new Error("create failed"));
    mocks.deleteApiKey.mockRejectedValue(new Error("delete failed"));
    mocks.deletePasskey.mockRejectedValue(new Error("delete failed"));
    mocks.updatePasskey.mockRejectedValue(new Error("rename failed"));
    const { AccountPage } = await import("@/domains/access/pages/account-page");

    render(<AccountPage />);

    fireEvent.click(screen.getByRole("button", { name: /Add passkey/i }));
    await waitFor(() => {
      expect(
        screen.getByText("Atlas could not add that passkey. Please try again."),
      ).not.toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: /Pencil/i }));
    fireEvent.change(screen.getByDisplayValue("Desk key"), {
      target: { value: "Broken key" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Check/i }));
    await waitFor(() => {
      expect(
        screen.getByText("Atlas could not rename that passkey. Please try again."),
      ).not.toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: /X/i }));
    fireEvent.click(screen.getByRole("button", { name: /Trash2/i }));
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

    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    await waitFor(() => {
      expect(
        screen.getByText("Atlas could not revoke that API key. Please try again."),
      ).not.toBeNull();
    });
  });

  it("handles passkey and API-key creation responses that omit generated data", async () => {
    mocks.addPasskey.mockResolvedValue({});
    mocks.createApiKey.mockResolvedValue({});
    const { AccountPage } = await import("@/domains/access/pages/account-page");

    render(<AccountPage />);

    fireEvent.click(screen.getByRole("checkbox", { name: "discovery:write" }));
    fireEvent.click(screen.getByRole("button", { name: /Add passkey/i }));

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
