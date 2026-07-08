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

describe("routes/_workspace layout", () => {
  it("returns the core workbench rail items when the session is local", async () => {
    const Component = await loadWorkspaceRouteComponent();
    renderWorkspaceRoute(Component);
    const layout = screen.getByTestId("workspace-layout");
    const railItems = JSON.parse(layout.dataset.railItems ?? "[]") as { label: string }[];
    expect(railItems.map((t) => t.label)).toEqual([
      "Home",
      "Research",
      "Coverage",
      "Briefs",
      "Browse",
      "Lists",
      "Watching",
      "Activity",
    ]);
    expect(screen.getByTestId("identity-slot")).toBeEmptyDOMElement();
  });

  it("surfaces saved-work rail items without Organization for a signed-in session that does not need it", async () => {
    const { useAtlasSession } = await import("@/domains/access");
    vi.mocked(useAtlasSession).mockReturnValue({
      data: {
        isLocal: false,
        user: { id: "u1", name: "Op", email: "ops@acme.test" },
        workspace: {
          activeOrganization: { id: "org_1", name: "Acme", workspaceType: "individual" },
          memberships: [{ id: "org_1", name: "Acme" }],
          onboarding: { needsWorkspace: false, hasPendingInvitations: false },
          capabilities: { canSwitchOrganizations: false },
        },
      },
    } as unknown as ReturnType<typeof useAtlasSession>);

    const Component = await loadWorkspaceRouteComponent();
    renderWorkspaceRoute(Component);
    const railItems = JSON.parse(
      screen.getByTestId("workspace-layout").dataset.railItems ?? "[]",
    ) as { label: string }[];
    expect(railItems.map((t) => t.label)).toEqual([
      "Home",
      "Research",
      "Coverage",
      "Briefs",
      "Browse",
      "Lists",
      "Watching",
      "Activity",
      "Account",
    ]);
  });

  it("falls back to the core workbench rail items when the session is null", async () => {
    const { useAtlasSession } = await import("@/domains/access");
    vi.mocked(useAtlasSession).mockReturnValue({
      data: null,
    } as unknown as ReturnType<typeof useAtlasSession>);

    const Component = await loadWorkspaceRouteComponent();
    renderWorkspaceRoute(Component);
    const railItems = JSON.parse(
      screen.getByTestId("workspace-layout").dataset.railItems ?? "[]",
    ) as { label: string }[];
    expect(railItems.map((t) => t.label)).toEqual([
      "Home",
      "Research",
      "Coverage",
      "Briefs",
      "Browse",
      "Lists",
      "Watching",
      "Activity",
    ]);
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
    vi.mocked(setActiveWorkspace).mockResolvedValue(undefined as never);

    const Component = await loadWorkspaceRouteComponent();
    renderWorkspaceRoute(Component);

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
      data: {
        isLocal: false,
        user: { id: "u1", name: "Willie", email: "person@atlas.test" },
        workspace: {
          activeOrganization: { id: "org_1", name: "Acme", workspaceType: "team" },
          memberships: [{ id: "org_1", name: "Acme" }],
          onboarding: { needsWorkspace: true, hasPendingInvitations: false },
          capabilities: { canSwitchOrganizations: true },
        },
      },
    } as unknown as ReturnType<typeof useAtlasSession>);
    vi.mocked(setActiveWorkspace).mockResolvedValue(undefined as never);

    const Component = await loadWorkspaceRouteComponent();
    renderWorkspaceRoute(Component);

    const railItems = JSON.parse(
      screen.getByTestId("workspace-layout").dataset.railItems ?? "[]",
    ) as { label: string }[];
    expect(railItems.map((t) => t.label)).toEqual([
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

    const select = screen.getByLabelText("workspace-select");
    await act(async () => {
      fireEvent.change(select, { target: { value: "org_1" } });
      await Promise.resolve();
    });
    expect(switchMutation).toHaveBeenCalledWith({ data: { organizationId: "org_1" } });
    expect(invalidate).toHaveBeenCalled();
  });

  it("falls back to an empty workspace-switcher value when no active organization is set", async () => {
    const { useAtlasSession } = await import("@/domains/access");
    vi.mocked(useAtlasSession).mockReturnValue({
      data: {
        isLocal: false,
        user: { id: "u1", name: "Op", email: "ops@acme.test" },
        workspace: {
          activeOrganization: null,
          memberships: [{ id: "org_1", name: "Acme" }],
          onboarding: { needsWorkspace: false, hasPendingInvitations: false },
          capabilities: { canSwitchOrganizations: true },
        },
      },
    } as unknown as ReturnType<typeof useAtlasSession>);

    const Component = await loadWorkspaceRouteComponent();
    renderWorkspaceRoute(Component);
    expect(screen.getByLabelText("workspace-select")).toBeInTheDocument();
  });

  it("falls back to the active organization name pill and the email when name is empty", async () => {
    const { useAtlasSession } = await import("@/domains/access");
    vi.mocked(useAtlasSession).mockReturnValue({
      data: {
        isLocal: false,
        user: { id: "u1", name: "  ", email: "ops@acme.test" },
        workspace: {
          activeOrganization: { id: "org_1", name: "Acme", workspaceType: "individual" },
          memberships: [],
          onboarding: { needsWorkspace: false, hasPendingInvitations: true },
          capabilities: { canSwitchOrganizations: false },
        },
      },
    } as unknown as ReturnType<typeof useAtlasSession>);

    const Component = await loadWorkspaceRouteComponent();
    renderWorkspaceRoute(Component);
    expect(screen.getAllByText("ops@acme.test").length).toBeGreaterThan(0);
    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.queryByLabelText("workspace-select")).toBeNull();
  });
});
