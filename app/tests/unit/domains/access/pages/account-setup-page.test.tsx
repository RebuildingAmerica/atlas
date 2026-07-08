// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import {
  accountSetupPageMocks,
  assignMock,
  defaultWorkspace,
} from "../../../../helpers/access/account-setup-page-test-bed";

describe("AccountSetupPage", () => {
  it("renders a loading state while account readiness is still being checked", async () => {
    accountSetupPageMocks.useAtlasSession.mockReturnValue({
      data: null,
      isPending: true,
      isRefetching: false,
      refetch: accountSetupPageMocks.refetch,
    });
    const { AccountSetupPage } = await import("@/domains/access/pages/auth/account-setup-page");

    render(<AccountSetupPage />);

    expect(screen.getByText("Loading account setup...")).not.toBeNull();
  });

  it("sends verification emails, adds passkeys, refreshes readiness, and redirects", async () => {
    accountSetupPageMocks.mutateStates.push({ isSuccess: true }, {}, {});
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
    accountSetupPageMocks.sendVerificationEmail.mockResolvedValue({ ok: true });
    accountSetupPageMocks.addPasskey.mockResolvedValue({
      data: {
        aaguid: "fbfc3007-154e-4ecc-8c0b-6e020557d7bd",
        id: "pk_123",
      },
    });
    accountSetupPageMocks.updatePasskey.mockResolvedValue(undefined);
    accountSetupPageMocks.waitForAtlasPasskeyRegistration.mockResolvedValue(undefined);
    const { AccountSetupPage } = await import("@/domains/access/pages/auth/account-setup-page");

    render(<AccountSetupPage redirectTo="/account" />);

    fireEvent.click(screen.getByRole("button", { name: "Send verification email" }));
    fireEvent.click(screen.getByRole("button", { name: "Add a passkey" }));

    await waitFor(() => {
      expect(accountSetupPageMocks.sendVerificationEmail).toHaveBeenCalledTimes(1);
      expect(accountSetupPageMocks.addPasskey).toHaveBeenCalledTimes(1);
    });
    expect(accountSetupPageMocks.updatePasskey).toHaveBeenCalledWith({
      data: { id: "pk_123", name: "iCloud Keychain" },
    });
    expect(accountSetupPageMocks.waitForAtlasPasskeyRegistration).toHaveBeenCalledTimes(1);
    expect(accountSetupPageMocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["auth", "session"],
    });
    expect(screen.getByText("Verification email sent.")).not.toBeNull();
    expect(accountSetupPageMocks.createWorkspace).toHaveBeenCalledWith({
      data: {
        name: "Test Operator's Workspace",
        slug: "test-operator-s-workspace",
        workspaceType: "individual",
      },
    });
    expect(assignMock).toHaveBeenCalledWith("/account");
  });

  it("signs operators out from the setup flow", async () => {
    accountSetupPageMocks.mutateStates.push({}, {}, {});
    accountSetupPageMocks.useAtlasSession.mockReturnValue({
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
      refetch: accountSetupPageMocks.refetch,
    });
    accountSetupPageMocks.signOut.mockResolvedValue(undefined);
    const { AccountSetupPage } = await import("@/domains/access/pages/auth/account-setup-page");

    render(<AccountSetupPage />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => {
      expect(accountSetupPageMocks.signOut).toHaveBeenCalledTimes(1);
    });
    expect(assignMock).toHaveBeenCalledWith("/");
  });

  it("refreshes readiness without redirecting when the account is still incomplete", async () => {
    accountSetupPageMocks.mutateStates.push({}, {}, {});
    accountSetupPageMocks.useAtlasSession.mockReturnValue({
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
      refetch: accountSetupPageMocks.refetch.mockResolvedValue({
        data: {
          accountReady: false,
        },
      }),
    });
    const { AccountSetupPage } = await import("@/domains/access/pages/auth/account-setup-page");

    render(<AccountSetupPage />);
    fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));

    await waitFor(() => {
      expect(accountSetupPageMocks.invalidateQueries).toHaveBeenCalledWith({
        queryKey: ["auth", "session"],
      });
      expect(accountSetupPageMocks.refetch.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    expect(assignMock).not.toHaveBeenCalled();
    expect(screen.getByText("You have 2 passkeys on this account.")).not.toBeNull();
  });
});
