// @vitest-environment jsdom

import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
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

vi.mock("@/platform/layout/page-layout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/platform/ui/button", () => ({
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
  useMutation: mocks.useMutation,
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

vi.mock("@/domains/access/client/session-confirmation", () => ({
  waitForAtlasPasskeyRegistration: mocks.waitForAtlasPasskeyRegistration,
}));

vi.mock("@/domains/access/passkeys.functions", () => ({
  updatePasskey: mocks.updatePasskey,
}));

vi.mock("@/domains/access/organizations.functions", () => ({
  createWorkspace: mocks.createWorkspace,
}));

vi.mock("@/domains/access/session.functions", () => ({
  getRpLogoutRedirect: mocks.getRpLogoutRedirect,
  sendVerificationEmail: mocks.sendVerificationEmail,
}));

afterEach(() => {
  cleanup();
});

describe("AccountSetupPage", () => {
  const defaultWorkspace = {
    onboarding: {
      hasPendingInvitations: false,
      needsWorkspace: false,
    },
  };

  const originalWindow = globalThis.window;
  let assignMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    mocks.addPasskey.mockReset();
    mocks.createWorkspace.mockReset();
    mocks.createWorkspace.mockResolvedValue(undefined);
    mocks.getRpLogoutRedirect.mockReset();
    mocks.getRpLogoutRedirect.mockResolvedValue({ url: null });
    mocks.invalidateQueries.mockReset();
    mocks.mutateStates.length = 0;
    mocks.refetch.mockReset();
    mocks.sendVerificationEmail.mockReset();
    mocks.signOut.mockReset();
    mocks.updatePasskey.mockReset();
    mocks.useAtlasSession.mockReset();
    mocks.useMutation.mockReset();
    mocks.useQueryClient.mockReset();
    mocks.waitForAtlasPasskeyRegistration.mockReset();
    mocks.useQueryClient.mockReturnValue({
      invalidateQueries: mocks.invalidateQueries,
    });
    // The page renders three mutations per render in a fixed order
    // (sendVerification, addPasskey, signOut).  Cycle through the seeded
    // states modulo three so the same scripted state survives the extra
    // re-renders triggered by `setLastCheckedAt` and the auto-mount
    // refresh, instead of getting drained on the first render.
    let mutationCallIndex = 0;
    mocks.useMutation.mockImplementation((config: { mutationFn?: () => Promise<unknown> }) => {
      const seeded = mocks.mutateStates;
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
    });
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

  it("renders a loading state while account readiness is still being checked", async () => {
    mocks.useAtlasSession.mockReturnValue({
      data: null,
      isPending: true,
      isRefetching: false,
      refetch: mocks.refetch,
    });
    const { AccountSetupPage } = await import("@/domains/access/pages/auth/account-setup-page");

    render(<AccountSetupPage />);

    expect(screen.getByText("Loading account setup...")).not.toBeNull();
  });

  it("sends verification emails, adds passkeys, refreshes readiness, and redirects", async () => {
    mocks.mutateStates.push({ isSuccess: true }, {}, {});
    mocks.useAtlasSession.mockReturnValue({
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
      refetch: mocks.refetch.mockResolvedValue({
        data: {
          accountReady: true,
          hasPasskey: true,
          passkeyCount: 1,
          user: { name: "Test Operator", email: "operator@atlas.test", emailVerified: true },
          workspace: {
            onboarding: {
              hasPendingInvitations: false,
              needsWorkspace: true,
            },
          },
        },
      }),
    });
    mocks.sendVerificationEmail.mockResolvedValue({ ok: true });
    mocks.addPasskey.mockResolvedValue({
      data: {
        aaguid: "fbfc3007-154e-4ecc-8c0b-6e020557d7bd",
        id: "pk_123",
      },
    });
    mocks.updatePasskey.mockResolvedValue(undefined);
    mocks.waitForAtlasPasskeyRegistration.mockResolvedValue(undefined);
    const { AccountSetupPage } = await import("@/domains/access/pages/auth/account-setup-page");

    render(<AccountSetupPage redirectTo="/account" />);

    fireEvent.click(screen.getByRole("button", { name: "Send verification email" }));
    fireEvent.click(screen.getByRole("button", { name: "Add a passkey" }));

    await waitFor(() => {
      expect(mocks.sendVerificationEmail).toHaveBeenCalledTimes(1);
      expect(mocks.addPasskey).toHaveBeenCalledTimes(1);
    });
    expect(mocks.updatePasskey).toHaveBeenCalledWith({
      data: { id: "pk_123", name: "iCloud Keychain" },
    });
    expect(mocks.waitForAtlasPasskeyRegistration).toHaveBeenCalledTimes(1);
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["auth", "session"],
    });
    expect(screen.getByText("Verification email sent.")).not.toBeNull();
    expect(mocks.createWorkspace).toHaveBeenCalledWith({
      data: {
        name: "Test Operator's Workspace",
        slug: "test-operator-s-workspace",
        workspaceType: "individual",
      },
    });
    expect(assignMock).toHaveBeenCalledWith("/account");
  });

  it("signs operators out from the setup flow", async () => {
    mocks.mutateStates.push({}, {}, {});
    mocks.useAtlasSession.mockReturnValue({
      data: {
        accountReady: true,
        hasPasskey: true,
        passkeyCount: 1,
        user: {
          email: "operator@atlas.test",
          emailVerified: true,
        },
        workspace: defaultWorkspace,
      },
      isPending: false,
      isRefetching: false,
      refetch: mocks.refetch,
    });
    mocks.signOut.mockResolvedValue(undefined);
    const { AccountSetupPage } = await import("@/domains/access/pages/auth/account-setup-page");

    render(<AccountSetupPage />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => {
      expect(mocks.signOut).toHaveBeenCalledTimes(1);
    });
    expect(assignMock).toHaveBeenCalledWith("/");
  });

  it("refreshes readiness without redirecting when the account is still incomplete", async () => {
    mocks.mutateStates.push({}, {}, {});
    mocks.useAtlasSession.mockReturnValue({
      data: {
        accountReady: false,
        hasPasskey: true,
        passkeyCount: 2,
        user: {
          email: "operator@atlas.test",
          emailVerified: true,
        },
        workspace: defaultWorkspace,
      },
      isPending: false,
      isRefetching: false,
      refetch: mocks.refetch.mockResolvedValue({
        data: {
          accountReady: false,
        },
      }),
    });
    const { AccountSetupPage } = await import("@/domains/access/pages/auth/account-setup-page");

    render(<AccountSetupPage />);
    fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));

    await waitFor(() => {
      expect(mocks.invalidateQueries).toHaveBeenCalledWith({
        queryKey: ["auth", "session"],
      });
      // The button click triggers one refetch; the auto-refresh on mount
      // adds another, so expect at least 2.
      expect(mocks.refetch.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    expect(assignMock).not.toHaveBeenCalled();
    expect(screen.getByText("You have 2 passkeys on this account.")).not.toBeNull();
  });

  it("renders verification and passkey error states", async () => {
    mocks.mutateStates.push(
      { error: new Error("Could not send") },
      { error: new Error("Atlas could not add that passkey."), isError: true },
      {},
    );
    mocks.useAtlasSession.mockReturnValue({
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
      refetch: mocks.refetch,
    });
    const { AccountSetupPage } = await import("@/domains/access/pages/auth/account-setup-page");

    render(<AccountSetupPage />);

    expect(
      screen.getByText("Atlas could not send the verification email right now."),
    ).not.toBeNull();
    expect(screen.getByText("Atlas could not add that passkey.")).not.toBeNull();
  });

  it("uses the generic passkey error when registration returns an empty error payload", async () => {
    mocks.mutateStates.push({}, {}, {});
    mocks.useAtlasSession.mockReturnValue({
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
      refetch: mocks.refetch,
    });
    mocks.addPasskey.mockResolvedValue({
      error: {},
    });
    const { AccountSetupPage } = await import("@/domains/access/pages/auth/account-setup-page");

    render(<AccountSetupPage />);

    const addPasskeyConfig = mocks.useMutation.mock.calls[1]?.[0] as {
      mutationFn: () => Promise<unknown>;
    };

    await expect(addPasskeyConfig.mutationFn()).rejects.toThrow(
      "Passkey authentication failed. Please try again.",
    );
  });

  it("renders pending labels while setup actions are in flight", async () => {
    mocks.mutateStates.push({ isPending: true }, { isPending: true }, { isPending: true });
    mocks.useAtlasSession.mockReturnValue({
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
      isRefetching: true,
      refetch: mocks.refetch,
    });
    const { AccountSetupPage } = await import("@/domains/access/pages/auth/account-setup-page");

    render(<AccountSetupPage />);

    expect(screen.getByText("Sending verification...")).not.toBeNull();
    expect(screen.getByText("Adding passkey...")).not.toBeNull();
    expect(screen.getByText("Refreshing...")).not.toBeNull();
    expect(screen.getByText("Signing out...")).not.toBeNull();
  });

  it("renders the generic non-Error passkey fallback message", async () => {
    mocks.mutateStates.push({}, { error: "pending failure" }, {});
    mocks.useAtlasSession.mockReturnValue({
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
      refetch: mocks.refetch,
    });
    const { AccountSetupPage } = await import("@/domains/access/pages/auth/account-setup-page");

    render(<AccountSetupPage />);

    expect(screen.getByText("Atlas could not add that passkey right now.")).not.toBeNull();
  });

  it("renders the singular passkey checklist copy and tolerates add-passkey responses without registration data", async () => {
    mocks.mutateStates.push({}, {}, {});
    mocks.useAtlasSession.mockReturnValue({
      data: {
        accountReady: true,
        hasPasskey: true,
        passkeyCount: 1,
        user: {
          email: "operator@atlas.test",
          emailVerified: true,
        },
        workspace: defaultWorkspace,
      },
      isPending: false,
      isRefetching: false,
      refetch: mocks.refetch,
    });
    mocks.addPasskey.mockResolvedValue({});
    const { AccountSetupPage } = await import("@/domains/access/pages/auth/account-setup-page");

    render(<AccountSetupPage />);

    expect(screen.getByText("You have 1 passkey on this account.")).not.toBeNull();

    const addPasskeyConfig = mocks.useMutation.mock.calls[1]?.[0] as {
      mutationFn: () => Promise<unknown>;
    };
    await addPasskeyConfig.mutationFn();

    expect(mocks.updatePasskey).not.toHaveBeenCalled();
  });

  it("continues without a passkey when the email is verified and the account is ready", async () => {
    mocks.mutateStates.push({}, {}, {});
    mocks.useAtlasSession.mockReturnValue({
      data: {
        accountReady: true,
        hasPasskey: false,
        passkeyCount: 0,
        user: {
          email: "operator@atlas.test",
          emailVerified: true,
          name: "Operator",
        },
        workspace: defaultWorkspace,
      },
      isPending: false,
      isRefetching: false,
      refetch: mocks.refetch.mockResolvedValue({
        data: {
          accountReady: true,
          hasPasskey: false,
          passkeyCount: 0,
          user: {
            email: "operator@atlas.test",
            emailVerified: true,
            name: "Operator",
          },
          workspace: {
            onboarding: {
              hasPendingInvitations: false,
              needsWorkspace: false,
            },
          },
        },
      }),
    });
    const { AccountSetupPage } = await import("@/domains/access/pages/auth/account-setup-page");

    render(<AccountSetupPage redirectTo="/account" />);

    fireEvent.click(screen.getByRole("button", { name: /Continue without a passkey/ }));

    await waitFor(() => {
      expect(assignMock).toHaveBeenCalledWith("/account");
    });
  });

  it("triggers the periodic auto-poll when the interval elapses", async () => {
    vi.useFakeTimers();
    try {
      mocks.mutateStates.push({}, {}, {});
      mocks.useAtlasSession.mockReturnValue({
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
        refetch: mocks.refetch.mockResolvedValue({ data: { accountReady: false } }),
      });
      const { AccountSetupPage } = await import("@/domains/access/pages/auth/account-setup-page");

      render(<AccountSetupPage />);
      const initialCalls = mocks.refetch.mock.calls.length;

      await act(async () => {
        vi.advanceTimersByTime(15_000);
        await Promise.resolve();
      });

      expect(mocks.refetch.mock.calls.length).toBeGreaterThan(initialCalls);
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-checks readiness when the tab returns to visible state", async () => {
    mocks.mutateStates.push({}, {}, {});
    mocks.useAtlasSession.mockReturnValue({
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
      refetch: mocks.refetch.mockResolvedValue({
        data: {
          accountReady: false,
        },
      }),
    });
    const { AccountSetupPage } = await import("@/domains/access/pages/auth/account-setup-page");

    render(<AccountSetupPage />);
    const initialCalls = mocks.refetch.mock.calls.length;

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));

    await waitFor(() => {
      expect(mocks.refetch.mock.calls.length).toBeGreaterThan(initialCalls);
    });
  });

  it("ignores visibility events when the tab is hidden", async () => {
    mocks.mutateStates.push({}, {}, {});
    mocks.useAtlasSession.mockReturnValue({
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
      refetch: mocks.refetch.mockResolvedValue({ data: { accountReady: false } }),
    });
    const { AccountSetupPage } = await import("@/domains/access/pages/auth/account-setup-page");

    render(<AccountSetupPage />);
    await waitFor(() => {
      expect(mocks.refetch.mock.calls.length).toBeGreaterThanOrEqual(1);
    });
    const callsBeforeHidden = mocks.refetch.mock.calls.length;

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));

    // Allow microtasks to flush; the hidden visibility state should not
    // trigger another refetch beyond the auto-mount one.
    await Promise.resolve();
    expect(mocks.refetch.mock.calls.length).toBe(callsBeforeHidden);
  });

  it("aborts the continue-without-passkey path when the refreshed session is still not ready", async () => {
    mocks.mutateStates.push({}, {}, {});
    mocks.useAtlasSession.mockReturnValue({
      data: {
        accountReady: true,
        hasPasskey: false,
        passkeyCount: 0,
        user: {
          email: "operator@atlas.test",
          emailVerified: true,
          name: "Operator",
        },
        workspace: defaultWorkspace,
      },
      isPending: false,
      isRefetching: false,
      refetch: mocks.refetch.mockResolvedValue({
        data: {
          accountReady: false,
        },
      }),
    });
    const { AccountSetupPage } = await import("@/domains/access/pages/auth/account-setup-page");

    render(<AccountSetupPage />);

    fireEvent.click(screen.getByRole("button", { name: /Continue without a passkey/ }));

    await waitFor(() => {
      expect(mocks.refetch.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("falls back to a zero-count passkey label when readiness omits the passkey count", async () => {
    mocks.mutateStates.push({}, {}, {});
    mocks.useAtlasSession.mockReturnValue({
      data: {
        accountReady: true,
        hasPasskey: true,
        passkeyCount: undefined,
        user: {
          email: "operator@atlas.test",
          emailVerified: true,
        },
        workspace: defaultWorkspace,
      },
      isPending: false,
      isRefetching: false,
      refetch: mocks.refetch,
    });
    const { AccountSetupPage } = await import("@/domains/access/pages/auth/account-setup-page");

    render(<AccountSetupPage />);

    expect(screen.getByText("You have 0 passkeys on this account.")).not.toBeNull();
  });

  it("falls back to the current session when refreshStatus yields no data on continue-without-passkey", async () => {
    mocks.mutateStates.push({}, {}, {});
    mocks.useAtlasSession.mockReturnValue({
      data: {
        accountReady: false,
        hasPasskey: false,
        passkeyCount: 0,
        user: {
          email: "operator@atlas.test",
          emailVerified: true,
          name: "Operator",
        },
        workspace: defaultWorkspace,
      },
      isPending: false,
      isRefetching: false,
      refetch: mocks.refetch.mockResolvedValue({ data: undefined }),
    });
    const { AccountSetupPage } = await import("@/domains/access/pages/auth/account-setup-page");

    render(<AccountSetupPage />);

    fireEvent.click(screen.getByRole("button", { name: /Continue without a passkey/ }));

    await waitFor(() => {
      expect(mocks.refetch.mock.calls.length).toBeGreaterThanOrEqual(1);
    });
    // Session.accountReady is false, so the continue path should bail without
    // assigning a redirect.
    expect(assignMock).not.toHaveBeenCalled();
  });

  it("only auto-refreshes once even when the redirect prop changes between renders", async () => {
    mocks.mutateStates.push({}, {}, {});
    mocks.useAtlasSession.mockReturnValue({
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
      refetch: mocks.refetch.mockResolvedValue({
        data: null,
      }),
    });
    const { AccountSetupPage } = await import("@/domains/access/pages/auth/account-setup-page");

    const { rerender } = render(<AccountSetupPage redirectTo="/a" />);
    await waitFor(() => {
      expect(mocks.refetch).toHaveBeenCalledTimes(1);
    });
    rerender(<AccountSetupPage redirectTo="/b" />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
  });
});
