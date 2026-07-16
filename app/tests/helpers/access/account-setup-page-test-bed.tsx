// @vitest-environment jsdom

import type { ReactNode } from "react";
import { afterEach, beforeEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

const accountSetupPageMocks = vi.hoisted(() => ({
  addPasskey: vi.fn(),
  createWorkspace: vi.fn(),
  getRpLogoutRedirect: vi.fn(),
  invalidateQueries: vi.fn(),
  mutateStates: [] as Record<string, unknown>[],
  refetch: vi.fn(),
  sendVerificationEmail: vi.fn(),
  signOut: vi.fn(),
  updatePasskey: vi.fn(),
  useAtlasSession: vi.fn(),
  useMutation: vi.fn(),
  useQueryClient: vi.fn(),
  waitForAtlasPasskeyRegistration: vi.fn(),
}));

export { accountSetupPageMocks };

vi.mock("@rebuildingamerica/atlas-ui/layout/page-layout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@rebuildingamerica/atlas-ui/ui/button", () => ({
  Button: ({
    children,
    disabled,
    onClick,
  }: {
    children: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button type="button" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock("@tanstack/react-query", () => ({
  useMutation: accountSetupPageMocks.useMutation,
  useQueryClient: accountSetupPageMocks.useQueryClient,
}));

vi.mock("@/domains/access/client/auth-client", () => ({
  getAuthClient: () => ({
    passkey: {
      addPasskey: accountSetupPageMocks.addPasskey,
    },
    signOut: accountSetupPageMocks.signOut,
  }),
}));

vi.mock("@/domains/access/client/use-atlas-session", () => ({
  atlasSessionQueryKey: ["auth", "session"],
  useAtlasSession: accountSetupPageMocks.useAtlasSession,
}));

vi.mock("@/domains/access/client/session-confirmation", () => ({
  waitForAtlasPasskeyRegistration: accountSetupPageMocks.waitForAtlasPasskeyRegistration,
}));

vi.mock("@/domains/access/passkeys.functions", () => ({
  updatePasskey: accountSetupPageMocks.updatePasskey,
}));

vi.mock("@/domains/access/organizations.functions", () => ({
  createWorkspace: accountSetupPageMocks.createWorkspace,
}));

vi.mock("@/domains/access/session.functions", () => ({
  getRpLogoutRedirect: accountSetupPageMocks.getRpLogoutRedirect,
  sendVerificationEmail: accountSetupPageMocks.sendVerificationEmail,
}));

export const defaultWorkspace = {
  onboarding: {
    hasPendingInvitations: false,
    needsWorkspace: false,
  },
};

const assignMock = vi.hoisted(() => vi.fn());

export { assignMock };

const originalWindow = globalThis.window;
let mutationCallIndex = 0;

beforeEach(() => {
  vi.resetModules();
  mutationCallIndex = 0;
  accountSetupPageMocks.addPasskey.mockReset();
  accountSetupPageMocks.createWorkspace.mockReset();
  accountSetupPageMocks.getRpLogoutRedirect.mockReset();
  accountSetupPageMocks.invalidateQueries.mockReset();
  accountSetupPageMocks.mutateStates.length = 0;
  accountSetupPageMocks.refetch.mockReset();
  accountSetupPageMocks.sendVerificationEmail.mockReset();
  accountSetupPageMocks.signOut.mockReset();
  accountSetupPageMocks.updatePasskey.mockReset();
  accountSetupPageMocks.useAtlasSession.mockReset();
  accountSetupPageMocks.useMutation.mockReset();
  accountSetupPageMocks.useQueryClient.mockReset();
  accountSetupPageMocks.waitForAtlasPasskeyRegistration.mockReset();
  assignMock.mockReset();
  accountSetupPageMocks.useQueryClient.mockReturnValue({
    invalidateQueries: accountSetupPageMocks.invalidateQueries,
  });
  accountSetupPageMocks.useMutation.mockImplementation(
    (config: { mutationFn?: (input?: unknown) => Promise<unknown> }) => {
      const seeded = accountSetupPageMocks.mutateStates;
      const state = seeded.length > 0 ? (seeded[mutationCallIndex % seeded.length] ?? {}) : {};
      mutationCallIndex += 1;
      return {
        error: state.error,
        isError: Boolean(state.error),
        isPending: state.isPending ?? false,
        isSuccess: state.isSuccess ?? false,
        mutate: () => {
          void config.mutationFn?.();
        },
        mutateAsync: config.mutationFn,
      };
    },
  );
  accountSetupPageMocks.useAtlasSession.mockReturnValue({
    data: {
      accountReady: false,
      hasPasskey: false,
      passkeyCount: 0,
      user: {
        email: "operator@atlas.test",
        emailVerified: false,
      },
      workspace: defaultWorkspace,
    },
    isPending: false,
    isRefetching: false,
    refetch: accountSetupPageMocks.refetch,
  });
  accountSetupPageMocks.addPasskey.mockResolvedValue({
    data: {
      aaguid: "fbfc3007-154e-4ecc-8c0b-6e020557d7bd",
      id: "pk_new",
    },
  });
  accountSetupPageMocks.createWorkspace.mockResolvedValue(undefined);
  accountSetupPageMocks.getRpLogoutRedirect.mockResolvedValue({ url: null });
  accountSetupPageMocks.sendVerificationEmail.mockResolvedValue({ ok: true });
  accountSetupPageMocks.signOut.mockResolvedValue(undefined);
  accountSetupPageMocks.updatePasskey.mockResolvedValue(undefined);
  accountSetupPageMocks.waitForAtlasPasskeyRegistration.mockResolvedValue(undefined);
  accountSetupPageMocks.invalidateQueries.mockResolvedValue(undefined);
  accountSetupPageMocks.refetch.mockResolvedValue({ data: undefined });

  const testWindow = Object.create(originalWindow) as Window & typeof globalThis;
  Object.defineProperty(testWindow, "location", {
    configurable: true,
    value: { assign: assignMock },
  });
  vi.stubGlobal("window", testWindow);
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});
