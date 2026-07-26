// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  acceptWorkspaceInvitation: vi.fn(),
  invalidateQueries: vi.fn(),
  setActiveWorkspace: vi.fn(),
  useAtlasSession: vi.fn(),
  useMutation: vi.fn(),
  useQueryClient: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useMutation: mocks.useMutation,
  useQueryClient: mocks.useQueryClient,
}));

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/access/client/use-atlas-session", () => ({
  atlasSessionQueryKey: ["auth", "session"],
  useAtlasSession: mocks.useAtlasSession,
}));

vi.mock("@/domains/access/organizations.functions", () => ({
  acceptWorkspaceInvitation: mocks.acceptWorkspaceInvitation,
  setActiveWorkspace: mocks.setActiveWorkspace,
}));

describe("AcceptInvitationPage", () => {
  interface OutcomeShape {
    status: string;
    workspaceName: string | null;
    workspaceSlug: string | null;
  }

  interface MutationConfig {
    mutationFn: (session: Record<string, unknown>) => Promise<OutcomeShape>;
    onSuccess?: (result: OutcomeShape) => void | Promise<void>;
    onError?: () => void;
  }

  interface InvitationOverrides {
    email?: string;
    id?: string;
  }

  const originalWindow = globalThis.window;
  let assignMock: ReturnType<typeof vi.fn>;

  function buildInvitation(overrides: InvitationOverrides): Record<string, unknown> {
    return {
      email: overrides.email ?? "invitee@atlas.test",
      expiresAt: null,
      id: overrides.id ?? "inv_1",
      organizationId: "org_1",
      organizationName: "Invited Team",
      organizationSlug: "invited-team",
      role: "member",
      workspaceType: "team",
    };
  }

  function buildSession(
    email: string,
    pendingInvitations: Record<string, unknown>[],
  ): Record<string, unknown> {
    return {
      accountReady: true,
      hasPasskey: true,
      isLocal: false,
      passkeyCount: 1,
      session: { id: "sess_1" },
      user: { email, emailVerified: true, id: "user_1", name: "Operator" },
      workspace: {
        activeOrganization: null,
        activeProducts: [],
        capabilities: {},
        memberships: [],
        onboarding: { hasPendingInvitations: true, needsWorkspace: false },
        pendingInvitations,
        resolvedCapabilities: {},
      },
    };
  }

  function installLiveMutation(): void {
    mocks.useMutation.mockImplementation((config: MutationConfig) => ({
      isPending: false,
      mutate: (session: Record<string, unknown>) => {
        void (async () => {
          try {
            const result = await config.mutationFn(session);
            await config.onSuccess?.(result);
          } catch {
            config.onError?.();
          }
        })();
      },
    }));
  }

  beforeEach(() => {
    vi.resetModules();
    mocks.acceptWorkspaceInvitation.mockReset().mockResolvedValue({ ok: true });
    mocks.invalidateQueries.mockReset().mockResolvedValue(undefined);
    mocks.setActiveWorkspace.mockReset().mockResolvedValue({ ok: true });
    mocks.useAtlasSession.mockReset();
    mocks.useMutation.mockReset();
    mocks.useQueryClient
      .mockReset()
      .mockReturnValue({ invalidateQueries: mocks.invalidateQueries });
    assignMock = vi.fn();
    const testWindow = Object.create(originalWindow) as Window & typeof globalThis;
    Object.defineProperty(testWindow, "location", {
      configurable: true,
      value: { assign: assignMock },
    });
    vi.stubGlobal("window", testWindow);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows a loading state while the session resolves", async () => {
    installLiveMutation();
    mocks.useAtlasSession.mockReturnValue({ data: undefined, isPending: true });
    const { AcceptInvitationPage } =
      await import("@/domains/access/pages/auth/accept-invitation-page");

    render(<AcceptInvitationPage invitationId="inv_1" />);

    expect(screen.getByText(/checking your invitation/i)).not.toBeNull();
    expect(mocks.acceptWorkspaceInvitation).not.toHaveBeenCalled();
    expect(assignMock).not.toHaveBeenCalled();
  });

  it("redirects an unauthenticated visitor through sign-in carrying the invitation", async () => {
    installLiveMutation();
    mocks.useAtlasSession.mockReturnValue({ data: null, isPending: false });
    const { AcceptInvitationPage } =
      await import("@/domains/access/pages/auth/accept-invitation-page");

    render(<AcceptInvitationPage invitationId="inv_1" />);

    await waitFor(() => {
      expect(assignMock).toHaveBeenCalledWith(
        "/sign-in?invitation=inv_1&redirect=%2Faccept-invitation%2Finv_1",
      );
    });
    expect(mocks.acceptWorkspaceInvitation).not.toHaveBeenCalled();
    expect(screen.getByText(/taking you to sign in/i)).not.toBeNull();
  });

  it("auto-accepts once, activates the joined workspace, and names it on success", async () => {
    installLiveMutation();
    mocks.useAtlasSession.mockReturnValue({
      data: buildSession("invitee@atlas.test", [buildInvitation({ id: "inv_1" })]),
      isPending: false,
    });
    const { AcceptInvitationPage } =
      await import("@/domains/access/pages/auth/accept-invitation-page");

    render(<AcceptInvitationPage invitationId="inv_1" />);

    await waitFor(() => {
      expect(screen.getByText(/Invited Team/)).not.toBeNull();
    });
    expect(mocks.acceptWorkspaceInvitation).toHaveBeenCalledWith({
      data: { invitationId: "inv_1" },
    });
    expect(mocks.acceptWorkspaceInvitation).toHaveBeenCalledTimes(1);
    expect(mocks.setActiveWorkspace).toHaveBeenCalledWith({ data: { organizationId: "org_1" } });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["auth", "session"] });
  });

  it("accepts without activating when the cached session predates the invite", async () => {
    installLiveMutation();
    mocks.useAtlasSession.mockReturnValue({
      data: buildSession("operator@atlas.test", []),
      isPending: false,
    });
    const { AcceptInvitationPage } =
      await import("@/domains/access/pages/auth/accept-invitation-page");

    render(<AcceptInvitationPage invitationId="inv_late" />);

    await waitFor(() => {
      expect(screen.getByText(/you've joined your workspace/i)).not.toBeNull();
    });
    expect(mocks.acceptWorkspaceInvitation).toHaveBeenCalledWith({
      data: { invitationId: "inv_late" },
    });
    expect(mocks.setActiveWorkspace).not.toHaveBeenCalled();
  });

  it("explains a wrong-account invitation without accepting or leaking detail", async () => {
    installLiveMutation();
    mocks.useAtlasSession.mockReturnValue({
      data: buildSession("operator@atlas.test", [
        buildInvitation({ email: "someone-else@atlas.test", id: "inv_1" }),
      ]),
      isPending: false,
    });
    const { AcceptInvitationPage } =
      await import("@/domains/access/pages/auth/accept-invitation-page");

    render(<AcceptInvitationPage invitationId="inv_1" />);

    await waitFor(() => {
      expect(screen.getByText(/different email/i)).not.toBeNull();
    });
    expect(mocks.acceptWorkspaceInvitation).not.toHaveBeenCalled();
    expect(mocks.setActiveWorkspace).not.toHaveBeenCalled();
  });

  it("shows generic copy and hides the raw error when acceptance fails", async () => {
    installLiveMutation();
    mocks.acceptWorkspaceInvitation.mockRejectedValue(new Error("boom-secret-detail"));
    mocks.useAtlasSession.mockReturnValue({
      data: buildSession("invitee@atlas.test", [buildInvitation({ id: "inv_1" })]),
      isPending: false,
    });
    const { AcceptInvitationPage } =
      await import("@/domains/access/pages/auth/accept-invitation-page");

    render(<AcceptInvitationPage invitationId="inv_1" />);

    await waitFor(() => {
      expect(screen.getByText(/can't be opened/i)).not.toBeNull();
    });
    expect(screen.queryByText(/boom-secret-detail/)).toBeNull();
    expect(mocks.setActiveWorkspace).not.toHaveBeenCalled();
  });

  it("renders the working state while acceptance is in flight", async () => {
    mocks.useMutation.mockImplementation((config: MutationConfig) => ({
      isPending: true,
      mutate: (session: Record<string, unknown>) => {
        void config.mutationFn(session);
      },
    }));
    mocks.useAtlasSession.mockReturnValue({
      data: buildSession("invitee@atlas.test", [buildInvitation({ id: "inv_1" })]),
      isPending: false,
    });
    const { AcceptInvitationPage } =
      await import("@/domains/access/pages/auth/accept-invitation-page");

    render(<AcceptInvitationPage invitationId="inv_1" />);

    await waitFor(() => {
      expect(mocks.acceptWorkspaceInvitation).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText(/joining your workspace/i)).not.toBeNull();
  });

  it("attempts acceptance only once across re-renders", async () => {
    installLiveMutation();
    mocks.useAtlasSession.mockReturnValue({
      data: buildSession("invitee@atlas.test", [buildInvitation({ id: "inv_1" })]),
      isPending: false,
    });
    const { AcceptInvitationPage } =
      await import("@/domains/access/pages/auth/accept-invitation-page");

    const { rerender } = render(<AcceptInvitationPage invitationId="inv_1" />);
    await waitFor(() => {
      expect(mocks.acceptWorkspaceInvitation).toHaveBeenCalledTimes(1);
    });
    rerender(<AcceptInvitationPage invitationId="inv_1" />);
    await Promise.resolve();
    expect(mocks.acceptWorkspaceInvitation).toHaveBeenCalledTimes(1);
  });
});
