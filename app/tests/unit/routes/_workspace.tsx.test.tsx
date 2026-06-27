// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@tanstack/react-query", () => ({
  useMutation: vi.fn(),
  useQueryClient: vi.fn(),
}));

vi.mock("@/domains/access", () => ({
  useAtlasSession: vi.fn(),
}));

vi.mock("@/domains/access/client/auth-client", () => ({
  getAuthClient: vi.fn(),
}));

vi.mock("@/domains/access/client/use-atlas-session", () => ({
  atlasSessionQueryKey: ["session"],
}));

vi.mock("@/domains/access/organizations.functions", () => ({
  setActiveWorkspace: vi.fn(),
}));

vi.mock("@/domains/access/server", () => ({
  requireReadyAtlasSession: vi.fn(),
}));

vi.mock("@/domains/access/session.functions", () => ({
  getRpLogoutRedirect: vi.fn(),
}));

vi.mock("@/domains/billing/components/resume-checkout-banner", () => ({
  ResumeCheckoutBanner: () => <div data-testid="resume-banner" />,
}));

vi.mock("@/platform/layout/workspace-layout", () => ({
  WorkspaceLayout: ({
    tabs,
    identitySlot,
    children,
  }: {
    tabs: { label: string; to: string }[];
    identitySlot: React.ReactNode;
    children: React.ReactNode;
  }) => (
    <div data-testid="workspace-layout" data-tabs={JSON.stringify(tabs)}>
      <div data-testid="identity-slot">{identitySlot}</div>
      {children}
    </div>
  ),
}));

vi.mock("@/platform/ui/select", () => ({
  Select: ({
    onChange,
    options,
    value,
    disabled,
  }: {
    onChange: (id: string) => void;
    options: { value: string; label: string }[];
    value: string;
    disabled?: boolean;
  }) => (
    <select
      aria-label="workspace-select"
      value={value}
      disabled={disabled}
      onChange={(event) => {
        onChange(event.target.value);
      }}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

describe("routes/_workspace layout", () => {
  beforeEach(async () => {
    const { resetRouterMocks } = await import("@/../tests/helpers/router-harness");
    resetRouterMocks();
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

  it("requires a ready session in beforeLoad", async () => {
    const access = await import("@/domains/access/server");
    const session = { user: { id: "u1" } };
    vi.mocked(access.requireReadyAtlasSession).mockResolvedValue(
      session as Awaited<ReturnType<typeof access.requireReadyAtlasSession>>,
    );

    const routeModule = await import("@/routes/_workspace");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    if (!Route.options.beforeLoad) throw new Error("Expected beforeLoad");
    const ctx = await Route.options.beforeLoad({ location: { href: "/dashboard" } });
    expect(access.requireReadyAtlasSession).toHaveBeenCalledWith("/dashboard");
    expect(ctx).toEqual({ session });
  });

  it("returns the core app tab list when the session is local", async () => {
    const { useAtlasSession } = await import("@/domains/access");
    vi.mocked(useAtlasSession).mockReturnValue({
      data: { isLocal: true, workspace: {} },
    } as unknown as ReturnType<typeof useAtlasSession>);

    const routeModule = await import("@/routes/_workspace");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);
    const layout = screen.getByTestId("workspace-layout");
    const tabs = JSON.parse(layout.dataset.tabs ?? "[]") as { label: string }[];
    expect(tabs.map((t) => t.label)).toEqual(["Home", "Research", "Browse", "Lists", "Activity"]);
    expect(screen.getByTestId("identity-slot")).toBeEmptyDOMElement();
  });

  it("surfaces saved-work tabs without Organization for a signed-in session that does not need it", async () => {
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

    const routeModule = await import("@/routes/_workspace");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);
    const tabs = JSON.parse(screen.getByTestId("workspace-layout").dataset.tabs ?? "[]") as {
      label: string;
    }[];
    expect(tabs.map((t) => t.label)).toEqual([
      "Home",
      "Research",
      "Browse",
      "Lists",
      "Activity",
      "Account",
    ]);
  });

  it("falls back to the core app tab list when the session is null", async () => {
    const { useAtlasSession } = await import("@/domains/access");
    vi.mocked(useAtlasSession).mockReturnValue({
      data: null,
    } as unknown as ReturnType<typeof useAtlasSession>);

    const routeModule = await import("@/routes/_workspace");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);
    const tabs = JSON.parse(screen.getByTestId("workspace-layout").dataset.tabs ?? "[]") as {
      label: string;
    }[];
    expect(tabs.map((t) => t.label)).toEqual(["Home", "Research", "Browse", "Lists", "Activity"]);
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

    const routeModule = await import("@/routes/_workspace");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);

    expect(captured).toBeDefined();
    if (!captured) throw new Error("Expected captured mutation options");
    await captured.mutationFn({ data: { organizationId: "org_1" } });
    expect(setActiveWorkspace).toHaveBeenCalledWith({ data: { organizationId: "org_1" } });
  });

  it("includes the Organization tab when onboarding needs it and renders the workspace switcher", async () => {
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
        user: { id: "u1", name: "Operator", email: "ops@acme.test" },
        workspace: {
          activeOrganization: { id: "org_1", name: "Acme", workspaceType: "team" },
          memberships: [{ id: "org_1", name: "Acme" }],
          onboarding: { needsWorkspace: true, hasPendingInvitations: false },
          capabilities: { canSwitchOrganizations: true },
        },
      },
    } as unknown as ReturnType<typeof useAtlasSession>);
    vi.mocked(setActiveWorkspace).mockResolvedValue(undefined as never);

    const routeModule = await import("@/routes/_workspace");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);

    const tabs = JSON.parse(screen.getByTestId("workspace-layout").dataset.tabs ?? "[]") as {
      label: string;
    }[];
    expect(tabs.map((t) => t.label)).toEqual([
      "Home",
      "Research",
      "Browse",
      "Lists",
      "Activity",
      "Organization",
      "Account",
    ]);
    expect(screen.getByText("Operator")).toBeInTheDocument();
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

    const routeModule = await import("@/routes/_workspace");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);
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

    const routeModule = await import("@/routes/_workspace");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);
    expect(screen.getByText("ops@acme.test")).toBeInTheDocument();
    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.queryByLabelText("workspace-select")).toBeNull();
  });

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
    } as Awaited<ReturnType<typeof getRpLogoutRedirect>>);

    const assignSpy = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, assign: assignSpy },
      writable: true,
      configurable: true,
    });

    const routeModule = await import("@/routes/_workspace");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);

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
    } as Awaited<ReturnType<typeof getRpLogoutRedirect>>);

    const routeModule = await import("@/routes/_workspace");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);

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

    const routeModule = await import("@/routes/_workspace");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);

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

    const routeModule = await import("@/routes/_workspace");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);

    await act(async () => {
      fireEvent.change(screen.getByLabelText("workspace-select"), {
        target: { value: "org_1" },
      });
      await Promise.resolve();
    });
    expect(screen.getByText("explicit")).toBeInTheDocument();
  });
});
