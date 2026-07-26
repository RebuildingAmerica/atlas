// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAtlasSessionFixture } from "@/../tests/fixtures/access/sessions";
import {
  loadWorkspaceRouteComponent,
  renderWorkspaceRoute,
} from "@/../tests/helpers/workspace-route-test-bed";

beforeEach(async () => {
  const { readRouterMocks, resetRouterMocks } = await import("@/../tests/helpers/router-harness");
  resetRouterMocks();
  readRouterMocks().useRouteContext.mockReturnValue({
    session: createAtlasSessionFixture({ isLocal: true }),
  });
  const { useAtlasSession } = await import("@/domains/access");
  vi.mocked(useAtlasSession).mockReturnValue({
    data: createAtlasSessionFixture({ isLocal: true }),
  } as unknown as ReturnType<typeof useAtlasSession>);
  const { useMutation, useQueryClient } = await import("@tanstack/react-query");
  vi.mocked(useMutation).mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
  } as unknown as ReturnType<typeof useMutation>);
  vi.mocked(useQueryClient).mockReturnValue({
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
  } as unknown as ReturnType<typeof useQueryClient>);
});

afterEach(() => {
  cleanup();
});

describe("routes/_workspace actions", () => {
  it("signs out by hitting RP logout and falls back to / when the URL is missing", async () => {
    const { useAtlasSession } = await import("@/domains/access");
    const { getAuthClient } = await import("@/domains/access/client/auth-client");
    const { getRpLogoutRedirect } = await import("@/domains/access/session.functions");

    vi.mocked(useAtlasSession).mockReturnValue({
      data: {
        isLocal: false,
        user: { id: "u1", name: "Op", email: "ops@acme.test" },
        workspace: {
          activeOrganization: null,
          memberships: [],
          onboarding: { needsWorkspace: false, hasPendingInvitations: false },
          capabilities: { canSwitchOrganizations: false },
        },
      },
    } as unknown as ReturnType<typeof useAtlasSession>);

    const signOut = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getAuthClient).mockReturnValue({
      signOut,
    } as unknown as ReturnType<typeof getAuthClient>);
    vi.mocked(getRpLogoutRedirect).mockResolvedValue({
      url: null,
    });

    const assignSpy = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, assign: assignSpy },
      writable: true,
      configurable: true,
    });

    const Component = await loadWorkspaceRouteComponent();
    await renderWorkspaceRoute(Component);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Sign out/ }));
      await Promise.resolve();
    });
    expect(signOut).toHaveBeenCalled();
    expect(assignSpy).toHaveBeenCalledWith("/");
  });

  it("surfaces an error message when sign-out fails", async () => {
    const { useAtlasSession } = await import("@/domains/access");
    const { getAuthClient } = await import("@/domains/access/client/auth-client");
    const { getRpLogoutRedirect } = await import("@/domains/access/session.functions");

    vi.mocked(useAtlasSession).mockReturnValue({
      data: {
        isLocal: false,
        user: { id: "u1", name: "Op", email: "ops@acme.test" },
        workspace: {
          activeOrganization: null,
          memberships: [],
          onboarding: { needsWorkspace: false, hasPendingInvitations: false },
          capabilities: { canSwitchOrganizations: false },
        },
      },
    } as unknown as ReturnType<typeof useAtlasSession>);

    vi.mocked(getAuthClient).mockReturnValue({
      signOut: vi.fn().mockRejectedValue(new Error("nope")),
    } as unknown as ReturnType<typeof getAuthClient>);
    vi.mocked(getRpLogoutRedirect).mockResolvedValue({
      url: "https://idp.test/logout",
    });

    const Component = await loadWorkspaceRouteComponent();
    await renderWorkspaceRoute(Component);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Sign out/ }));
      await Promise.resolve();
    });
    expect(screen.getByText(/Atlas could not sign you out right now/)).toBeInTheDocument();
  });

  it("surfaces a workspace-switch error when the mutation fails with a non-Error", async () => {
    const { useAtlasSession } = await import("@/domains/access");
    const { useMutation } = await import("@tanstack/react-query");
    const switchMutation = vi.fn().mockRejectedValue("plain string error");
    vi.mocked(useMutation).mockReturnValue({
      mutateAsync: switchMutation,
      isPending: false,
    } as unknown as ReturnType<typeof useMutation>);
    vi.mocked(useAtlasSession).mockReturnValue({
      data: {
        isLocal: false,
        user: { id: "u1", name: "Op", email: "ops@acme.test" },
        workspace: {
          activeOrganization: { id: "org_1", name: "Acme", workspaceType: "individual" },
          memberships: [{ id: "org_1", name: "Acme" }],
          onboarding: { needsWorkspace: false, hasPendingInvitations: false },
          capabilities: { canSwitchOrganizations: true },
        },
      },
    } as unknown as ReturnType<typeof useAtlasSession>);

    const Component = await loadWorkspaceRouteComponent();
    await renderWorkspaceRoute(Component);

    await act(async () => {
      fireEvent.change(screen.getByLabelText("workspace-select"), {
        target: { value: "org_1" },
      });
      await Promise.resolve();
    });
    expect(screen.getByText("Atlas could not switch workspaces right now.")).toBeInTheDocument();
  });

  it("surfaces a workspace-switch Error message verbatim when the mutation rejects", async () => {
    const { useAtlasSession } = await import("@/domains/access");
    const { useMutation } = await import("@tanstack/react-query");
    const switchMutation = vi.fn().mockRejectedValue(new Error("explicit"));
    vi.mocked(useMutation).mockReturnValue({
      mutateAsync: switchMutation,
      isPending: false,
    } as unknown as ReturnType<typeof useMutation>);
    vi.mocked(useAtlasSession).mockReturnValue({
      data: {
        isLocal: false,
        user: { id: "u1", name: "Op", email: "ops@acme.test" },
        workspace: {
          activeOrganization: { id: "org_1", name: "Acme", workspaceType: "individual" },
          memberships: [{ id: "org_1", name: "Acme" }],
          onboarding: { needsWorkspace: false, hasPendingInvitations: false },
          capabilities: { canSwitchOrganizations: true },
        },
      },
    } as unknown as ReturnType<typeof useAtlasSession>);

    const Component = await loadWorkspaceRouteComponent();
    await renderWorkspaceRoute(Component);

    await act(async () => {
      fireEvent.change(screen.getByLabelText("workspace-select"), {
        target: { value: "org_1" },
      });
      await Promise.resolve();
    });
    expect(screen.getByText("explicit")).toBeInTheDocument();
  });
});
