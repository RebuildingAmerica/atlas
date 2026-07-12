// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  accountSetupPageMocks,
  defaultWorkspace,
} from "../../../../helpers/access/account-setup-page-test-bed";

describe("AccountSetupPage", () => {
  it("renders verification and passkey error states", async () => {
    accountSetupPageMocks.mutateStates.push(
      { error: new Error("Could not send") },
      { error: new Error("Atlas could not add that passkey."), isError: true },
      {},
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
    const { AccountSetupPage } = await import("@/domains/access/pages/auth/account-setup-page");

    render(<AccountSetupPage />);

    expect(
      screen.getByText("Atlas could not send the verification email right now."),
    ).not.toBeNull();
    expect(screen.getByText("Atlas could not add that passkey.")).not.toBeNull();
  });

  it("uses the generic passkey error when registration returns an empty error payload", async () => {
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
      refetch: accountSetupPageMocks.refetch,
    });
    accountSetupPageMocks.addPasskey.mockResolvedValue({
      error: {},
    });
    const { AccountSetupPage } = await import("@/domains/access/pages/auth/account-setup-page");

    render(<AccountSetupPage />);

    const addPasskeyConfig = accountSetupPageMocks.useMutation.mock.calls[1]?.[0] as {
      mutationFn: () => Promise<unknown>;
    };

    await expect(addPasskeyConfig.mutationFn()).rejects.toThrow(
      "Passkey authentication failed. Please try again.",
    );
  });

  it("renders pending labels while setup actions are in flight", async () => {
    accountSetupPageMocks.mutateStates.push(
      { isPending: true },
      { isPending: true },
      { isPending: true },
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
      isRefetching: true,
      refetch: accountSetupPageMocks.refetch,
    });
    const { AccountSetupPage } = await import("@/domains/access/pages/auth/account-setup-page");

    render(<AccountSetupPage />);

    expect(screen.getByText("Sending verification...")).not.toBeNull();
    expect(screen.getByText("Adding passkey...")).not.toBeNull();
    expect(screen.getByText("Refreshing...")).not.toBeNull();
    expect(screen.getByText("Signing out...")).not.toBeNull();
  });

  it("renders the generic non-Error passkey fallback message", async () => {
    accountSetupPageMocks.mutateStates.push({}, { error: "pending failure" }, {});
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
    const { AccountSetupPage } = await import("@/domains/access/pages/auth/account-setup-page");

    render(<AccountSetupPage />);

    expect(screen.getByText("Atlas could not add that passkey right now.")).not.toBeNull();
  });

  it("renders the singular passkey checklist copy and tolerates add-passkey responses without registration data", async () => {
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
    accountSetupPageMocks.addPasskey.mockResolvedValue({});
    const { AccountSetupPage } = await import("@/domains/access/pages/auth/account-setup-page");

    render(<AccountSetupPage />);

    expect(screen.getByText("You have 1 passkey on this account.")).not.toBeNull();

    const addPasskeyConfig = accountSetupPageMocks.useMutation.mock.calls[1]?.[0] as {
      mutationFn: () => Promise<unknown>;
    };
    await addPasskeyConfig.mutationFn();

    expect(accountSetupPageMocks.updatePasskey).not.toHaveBeenCalled();
  });
});
