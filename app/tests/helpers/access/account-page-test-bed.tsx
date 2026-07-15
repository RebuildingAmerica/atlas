// @vitest-environment jsdom

import type { ReactNode } from "react";
import { afterEach, beforeEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { createAtlasSessionFixture, createAtlasWorkspace } from "../../fixtures/access/sessions";

const accountPageMocks = vi.hoisted(() => ({
  addPasskey: vi.fn(),
  confirm: vi.fn(),
  createApiKey: vi.fn(),
  disconnectAtprotoIdentity: vi.fn(),
  deleteApiKey: vi.fn(),
  deletePasskey: vi.fn(),
  listScoutDevices: vi.fn(),
  invalidateQueries: vi.fn(),
  listAtprotoIdentities: vi.fn(),
  refreshAtprotoIdentity: vi.fn(),
  revokeScoutDevice: vi.fn(),
  updatePasskey: vi.fn(),
  signalUnknownPasskey: vi.fn(),
  useAtlasSession: vi.fn(),
  useMutation: vi.fn(),
  useQuery: vi.fn(),
  useQueryClient: vi.fn(),
}));

export { accountPageMocks };

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
  useMutation: accountPageMocks.useMutation,
  useQuery: accountPageMocks.useQuery,
  useQueryClient: accountPageMocks.useQueryClient,
}));

vi.mock("@/domains/access/client/auth-client", () => ({
  getAuthClient: () => ({
    passkey: {
      addPasskey: accountPageMocks.addPasskey,
    },
  }),
}));

vi.mock("@/domains/access/client/use-atlas-session", () => ({
  atlasSessionQueryKey: ["auth", "session"],
  useAtlasSession: accountPageMocks.useAtlasSession,
}));

vi.mock("@rebuildingamerica/atlas-api-client/generated/atlas/identity/identity", () => ({
  disconnectAtprotoIdentity: accountPageMocks.disconnectAtprotoIdentity,
  listAtprotoIdentities: accountPageMocks.listAtprotoIdentities,
  refreshAtprotoIdentity: accountPageMocks.refreshAtprotoIdentity,
}));

vi.mock("@/platform/ui/confirm-dialog", () => ({
  useConfirmDialog: () => ({ confirm: accountPageMocks.confirm }),
}));

vi.mock("@/domains/access/api-keys.functions", () => ({
  createApiKey: accountPageMocks.createApiKey,
  deleteApiKey: accountPageMocks.deleteApiKey,
  listApiKeys: vi.fn(),
}));

vi.mock("@/domains/access/passkeys.functions", () => ({
  deletePasskey: accountPageMocks.deletePasskey,
  listPasskeys: vi.fn(),
  updatePasskey: accountPageMocks.updatePasskey,
}));

vi.mock("@/domains/access/passkey-signal", () => ({
  signalUnknownPasskey: accountPageMocks.signalUnknownPasskey,
}));

vi.mock("@/domains/access/scout-devices.functions", () => ({
  listScoutDevices: accountPageMocks.listScoutDevices,
  revokeScoutDevice: accountPageMocks.revokeScoutDevice,
}));

vi.mock("@/domains/billing/components/workspace-billing-section", () => ({
  WorkspaceBillingSection: () => <div data-testid="billing-section">Billing</div>,
}));

afterEach(() => {
  window.history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
  cleanup();
});

export const setQueryResults = ({
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
  atprotoIdentities = [],
  atprotoIdentitiesError = false,
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
  atprotoIdentities?: {
    connected_at: string;
    control_status: "active" | "conflict";
    current_handle: string;
    did: string;
    id: string;
    last_checked_at?: string | null;
    last_resolution_error?: string | null;
    pds_url?: string | null;
    profiles?: { id: string; name: string; slug: string; type: string }[];
    resolution_status: "verified" | "needs_attention";
    verified_at?: string | null;
  }[];
  atprotoIdentitiesError?: boolean;
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
  accountPageMocks.useQuery.mockImplementation(({ queryKey }: { queryKey: readonly string[] }) => {
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

    if (queryKey[1] === "atproto-identities") {
      return {
        data: atprotoIdentities,
        isError: atprotoIdentitiesError,
        isPending: false,
      };
    }

    throw new Error(`Unexpected query key: ${JSON.stringify(queryKey)}`);
  });
};

export function isNewPasskeyRename(payload: unknown) {
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
  accountPageMocks.addPasskey.mockReset();
  accountPageMocks.confirm.mockReset();
  accountPageMocks.createApiKey.mockReset();
  accountPageMocks.deleteApiKey.mockReset();
  accountPageMocks.deletePasskey.mockReset();
  accountPageMocks.disconnectAtprotoIdentity.mockReset();
  accountPageMocks.listScoutDevices.mockReset();
  accountPageMocks.invalidateQueries.mockReset();
  accountPageMocks.listAtprotoIdentities.mockReset();
  accountPageMocks.refreshAtprotoIdentity.mockReset();
  accountPageMocks.revokeScoutDevice.mockReset();
  accountPageMocks.updatePasskey.mockReset();
  accountPageMocks.signalUnknownPasskey.mockReset();
  accountPageMocks.useAtlasSession.mockReset();
  accountPageMocks.useMutation.mockReset();
  accountPageMocks.useQuery.mockReset();
  accountPageMocks.useQueryClient.mockReset();
  accountPageMocks.useQueryClient.mockReturnValue({
    invalidateQueries: accountPageMocks.invalidateQueries.mockResolvedValue(undefined),
  });
  accountPageMocks.confirm.mockResolvedValue(true);
  accountPageMocks.disconnectAtprotoIdentity.mockResolvedValue(undefined);
  accountPageMocks.listAtprotoIdentities.mockResolvedValue([]);
  accountPageMocks.useMutation.mockImplementation(
    (config: {
      mutationFn?: (input?: unknown) => Promise<unknown>;
      onError?: () => void;
      onSettled?: () => void | Promise<void>;
      onSuccess?: (result?: unknown, variables?: unknown) => void | Promise<void>;
    }) => ({
      isPending: false,
      mutate: (input?: unknown) => {
        Promise.resolve(config.mutationFn?.(input))
          .then(async (result) => {
            await config.onSuccess?.(result, input);
          })
          .catch(() => {
            config.onError?.();
          })
          .finally(() => {
            void config.onSettled?.();
          });
      },
      mutateAsync: async (input?: unknown) => {
        try {
          const result = await config.mutationFn?.(input);
          await config.onSuccess?.(result, input);
          await config.onSettled?.();
          return result;
        } catch (error) {
          config.onError?.();
          await config.onSettled?.();
          throw error;
        }
      },
    }),
  );
  accountPageMocks.useAtlasSession.mockReturnValue({
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
  accountPageMocks.addPasskey.mockResolvedValue({
    data: {
      aaguid: "fbfc3007-154e-4ecc-8c0b-6e020557d7bd",
      id: "pk_new",
    },
  });
  accountPageMocks.createApiKey.mockResolvedValue({
    key: "atlas_secret_key",
  });
  accountPageMocks.deleteApiKey.mockResolvedValue(undefined);
  accountPageMocks.deletePasskey.mockResolvedValue(undefined);
  accountPageMocks.revokeScoutDevice.mockResolvedValue(undefined);
  accountPageMocks.updatePasskey.mockResolvedValue(undefined);
});
