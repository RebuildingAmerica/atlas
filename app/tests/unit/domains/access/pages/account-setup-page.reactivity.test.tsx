// @vitest-environment jsdom

import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  accountSetupPageMocks,
  defaultWorkspace,
} from "../../../../helpers/access/account-setup-page-test-bed";

describe("AccountSetupPage", () => {
  it("triggers the periodic auto-poll when the interval elapses", async () => {
    vi.useFakeTimers();
    try {
      accountSetupPageMocks.mutateStates.push({}, {}, {});
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
        refetch: accountSetupPageMocks.refetch.mockResolvedValue({ data: { accountReady: false } }),
      });
      const { AccountSetupPage } = await import("@/domains/access/pages/auth/account-setup-page");

      render(<AccountSetupPage />);
      const initialCalls = accountSetupPageMocks.refetch.mock.calls.length;

      await act(async () => {
        vi.advanceTimersByTime(15_000);
        await Promise.resolve();
      });

      expect(accountSetupPageMocks.refetch.mock.calls.length).toBeGreaterThan(initialCalls);
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-checks readiness when the tab returns to visible state", async () => {
    accountSetupPageMocks.mutateStates.push({}, {}, {});
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
      refetch: accountSetupPageMocks.refetch.mockResolvedValue({
        data: {
          accountReady: false,
        },
      }),
    });
    const { AccountSetupPage } = await import("@/domains/access/pages/auth/account-setup-page");

    render(<AccountSetupPage />);
    const initialCalls = accountSetupPageMocks.refetch.mock.calls.length;

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));

    await waitFor(() => {
      expect(accountSetupPageMocks.refetch.mock.calls.length).toBeGreaterThan(initialCalls);
    });
  });

  it("ignores visibility events when the tab is hidden", async () => {
    accountSetupPageMocks.mutateStates.push({}, {}, {});
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
      refetch: accountSetupPageMocks.refetch.mockResolvedValue({ data: { accountReady: false } }),
    });
    const { AccountSetupPage } = await import("@/domains/access/pages/auth/account-setup-page");

    render(<AccountSetupPage />);
    await waitFor(() => {
      expect(accountSetupPageMocks.refetch.mock.calls.length).toBeGreaterThanOrEqual(1);
    });
    const callsBeforeHidden = accountSetupPageMocks.refetch.mock.calls.length;

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));

    await Promise.resolve();
    expect(accountSetupPageMocks.refetch.mock.calls.length).toBe(callsBeforeHidden);
  });

  it("falls back to a zero-count passkey label when readiness omits the passkey count", async () => {
    accountSetupPageMocks.mutateStates.push({}, {}, {});
    accountSetupPageMocks.useAtlasSession.mockReturnValue({
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
      refetch: accountSetupPageMocks.refetch,
    });
    const { AccountSetupPage } = await import("@/domains/access/pages/auth/account-setup-page");

    render(<AccountSetupPage />);

    expect(screen.getByText("You have 0 passkeys on this account.")).not.toBeNull();
  });

  it("only auto-refreshes once even when the redirect prop changes between renders", async () => {
    accountSetupPageMocks.mutateStates.push({}, {}, {});
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
      refetch: accountSetupPageMocks.refetch.mockResolvedValue({
        data: null,
      }),
    });
    const { AccountSetupPage } = await import("@/domains/access/pages/auth/account-setup-page");

    const { rerender } = render(<AccountSetupPage redirectTo="/a" />);
    await waitFor(() => {
      expect(accountSetupPageMocks.refetch).toHaveBeenCalledTimes(1);
    });
    rerender(<AccountSetupPage redirectTo="/b" />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(accountSetupPageMocks.refetch).toHaveBeenCalledTimes(1);
  });
});
