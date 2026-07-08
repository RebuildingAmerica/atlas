// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  changeWorkspace,
  renderWorkspaceRoute,
  setupWorkspaceRouteTest,
  workspaceRailLabels,
  workspaceSession,
} from "./_workspace-test-support";

describe("routes/_workspace identity controls", () => {
  beforeEach(async () => {
    await setupWorkspaceRouteTest();
  });

  afterEach(() => {
    cleanup();
  });

  it("delegates the workspace-switch mutationFn to setActiveWorkspace", async () => {
    const { useAtlasSession } = await import("@/domains/access");
    const { useMutation } = await import("@tanstack/react-query");
    const { setActiveWorkspace } = await import("@/domains/access/organizations.functions");
    interface MutationOptions {
      mutationFn: (input: Parameters<typeof setActiveWorkspace>[0]) => unknown;
    }
    let captured: MutationOptions | undefined;
    vi.mocked(useMutation).mockImplementation(((options: MutationOptions) => {
      captured = options;
      return {
        mutateAsync: vi.fn().mockResolvedValue(undefined),
        isPending: false,
      };
    }) as unknown as typeof useMutation);
    vi.mocked(useAtlasSession).mockReturnValue({
      data: workspaceSession({ canSwitchOrganizations: true }),
    } as unknown as ReturnType<typeof useAtlasSession>);
    vi.mocked(setActiveWorkspace).mockResolvedValue(undefined as never);

    await renderWorkspaceRoute();

    expect(captured).toBeDefined();
    if (!captured) throw new Error("Expected captured mutation options");
    await captured.mutationFn({ data: { organizationId: "org_1" } });
    expect(setActiveWorkspace).toHaveBeenCalledWith({ data: { organizationId: "org_1" } });
  });

  it("includes Organization in the rail when onboarding needs it and renders the workspace switcher", async () => {
    const { useAtlasSession } = await import("@/domains/access");
    const { setActiveWorkspace } = await import("@/domains/access/organizations.functions");
    const { useMutation, useQueryClient } = await import("@tanstack/react-query");
    const switchMutation = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useMutation).mockImplementation(((options: {
      mutationFn: typeof setActiveWorkspace;
    }) => ({
      mutateAsync: switchMutation,
      isPending: false,
      __mutationFn: options.mutationFn,
    })) as unknown as typeof useMutation);
    const invalidate = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useQueryClient).mockReturnValue({
      invalidateQueries: invalidate,
    } as unknown as ReturnType<typeof useQueryClient>);
    vi.mocked(useAtlasSession).mockReturnValue({
      data: workspaceSession({
        canSwitchOrganizations: true,
        name: "Willie",
        needsWorkspace: true,
        workspaceType: "team",
      }),
    } as unknown as ReturnType<typeof useAtlasSession>);
    vi.mocked(setActiveWorkspace).mockResolvedValue(undefined as never);

    await renderWorkspaceRoute();

    expect(workspaceRailLabels()).toEqual([
      "Home",
      "Research",
      "Coverage",
      "Briefs",
      "Browse",
      "Lists",
      "Watching",
      "Activity",
      "Organization",
      "Account",
    ]);
    expect(screen.getAllByText("Willie").length).toBeGreaterThan(0);
    expect(screen.getByText("Enterprise SSO")).toBeInTheDocument();

    await act(async () => {
      fireEvent.change(screen.getByLabelText("workspace-select"), {
        target: { value: "org_1" },
      });
      await Promise.resolve();
    });
    expect(switchMutation).toHaveBeenCalledWith({ data: { organizationId: "org_1" } });
    expect(invalidate).toHaveBeenCalled();
  });

  it("falls back to an empty workspace-switcher value when no active organization is set", async () => {
    const { useAtlasSession } = await import("@/domains/access");
    vi.mocked(useAtlasSession).mockReturnValue({
      data: workspaceSession({ activeOrganization: null, canSwitchOrganizations: true }),
    } as unknown as ReturnType<typeof useAtlasSession>);

    await renderWorkspaceRoute();

    expect(screen.getByLabelText("workspace-select")).toBeInTheDocument();
  });

  it("falls back to the active organization name pill and the email when name is empty", async () => {
    const { useAtlasSession } = await import("@/domains/access");
    vi.mocked(useAtlasSession).mockReturnValue({
      data: workspaceSession({
        hasPendingInvitations: true,
        memberships: [],
        name: "  ",
      }),
    } as unknown as ReturnType<typeof useAtlasSession>);

    await renderWorkspaceRoute();

    expect(screen.getAllByText("ops@acme.test").length).toBeGreaterThan(0);
    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.queryByLabelText("workspace-select")).toBeNull();
  });

  it("signs out by hitting RP logout and falls back to / when the URL is missing", async () => {
    const { useAtlasSession } = await import("@/domains/access");
    const { getAuthClient } = await import("@/domains/access/client/auth-client");
    const { getRpLogoutRedirect } = await import("@/domains/access/session.functions");

    vi.mocked(useAtlasSession).mockReturnValue({
      data: workspaceSession({ activeOrganization: null, memberships: [] }),
    } as unknown as ReturnType<typeof useAtlasSession>);
    const signOut = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getAuthClient).mockReturnValue({
      signOut,
    } as unknown as ReturnType<typeof getAuthClient>);
    vi.mocked(getRpLogoutRedirect).mockResolvedValue({ url: null });
    const assignSpy = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, assign: assignSpy },
      writable: true,
      configurable: true,
    });

    await renderWorkspaceRoute();

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
      data: workspaceSession({ activeOrganization: null, memberships: [] }),
    } as unknown as ReturnType<typeof useAtlasSession>);
    vi.mocked(getAuthClient).mockReturnValue({
      signOut: vi.fn().mockRejectedValue(new Error("nope")),
    } as unknown as ReturnType<typeof getAuthClient>);
    vi.mocked(getRpLogoutRedirect).mockResolvedValue({ url: "https://idp.test/logout" });

    await renderWorkspaceRoute();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Sign out/ }));
      await Promise.resolve();
    });
    expect(screen.getByText(/Atlas could not sign you out right now/)).toBeInTheDocument();
  });

  it("surfaces workspace-switch errors", async () => {
    const { useAtlasSession } = await import("@/domains/access");
    const { useMutation } = await import("@tanstack/react-query");
    const switchMutation = vi
      .fn()
      .mockRejectedValueOnce("plain string error")
      .mockRejectedValueOnce(new Error("explicit"));
    vi.mocked(useMutation).mockReturnValue({
      mutateAsync: switchMutation,
      isPending: false,
    } as unknown as ReturnType<typeof useMutation>);
    vi.mocked(useAtlasSession).mockReturnValue({
      data: workspaceSession({ canSwitchOrganizations: true }),
    } as unknown as ReturnType<typeof useAtlasSession>);

    await renderWorkspaceRoute();
    await changeWorkspace();
    expect(screen.getByText("Atlas could not switch workspaces right now.")).toBeInTheDocument();
    cleanup();

    await setupWorkspaceRouteTest();
    vi.mocked(useMutation).mockReturnValue({
      mutateAsync: switchMutation,
      isPending: false,
    } as unknown as ReturnType<typeof useMutation>);
    vi.mocked(useAtlasSession).mockReturnValue({
      data: workspaceSession({ canSwitchOrganizations: true }),
    } as unknown as ReturnType<typeof useAtlasSession>);
    await renderWorkspaceRoute();
    await changeWorkspace();
    expect(screen.getByText("explicit")).toBeInTheDocument();
  });
});
