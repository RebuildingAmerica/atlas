// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAtlasSessionFixture,
  createAtlasWorkspace,
} from "@/../tests/fixtures/access/sessions";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@headlessui/react", () => ({
  Popover: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  PopoverButton: ({ children, className }: { children: ReactNode; className?: string }) => (
    <button type="button" className={className}>
      {children}
    </button>
  ),
  PopoverPanel: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));

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
    identitySlot: ReactNode;
    children: ReactNode;
  }) => (
    <div data-testid="workspace-layout" data-rail-items={JSON.stringify(tabs)}>
      <div data-testid="identity-slot">{identitySlot}</div>
      {children}
    </div>
  ),
}));

vi.mock("@rebuildingamerica/atlas-ui/ui/select", () => ({
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

beforeEach(async () => {
  const { readRouterMocks, resetRouterMocks } = await import("@/../tests/helpers/router-harness");
  resetRouterMocks();
  readRouterMocks().useRouteContext.mockReturnValue({
    session: createAtlasSessionFixture({ isLocal: true }),
  });
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

describe("routes/_workspace beforeLoad", () => {
  it("requires a ready session in beforeLoad", async () => {
    const access = await import("@/domains/access/server");
    const session = createAtlasSessionFixture();
    vi.mocked(access.requireReadyAtlasSession).mockResolvedValue(session);

    const routeModule = await import("@/routes/_workspace");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    if (!Route.options.beforeLoad) throw new Error("Expected beforeLoad");
    const ctx = await Route.options.beforeLoad({ location: { href: "/dashboard" } });
    expect(access.requireReadyAtlasSession).toHaveBeenCalledWith("/dashboard");
    expect(ctx).toEqual({ session });
  });

  it("redirects workspace-less sessions away from app routes before child loaders run", async () => {
    const access = await import("@/domains/access/server");
    const session = createAtlasSessionFixture({
      workspace: createAtlasWorkspace({
        activeOrganization: null,
        memberships: [],
        onboarding: { needsWorkspace: true },
      }),
    });
    vi.mocked(access.requireReadyAtlasSession).mockResolvedValue(session);

    const routeModule = await import("@/routes/_workspace");
    const { asRouteStub, readRouterMocks } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    if (!Route.options.beforeLoad) throw new Error("Expected beforeLoad");
    await expect(Route.options.beforeLoad({ location: { href: "/discovery" } })).rejects.toThrow(
      "Redirect",
    );
    expect(readRouterMocks().redirect).toHaveBeenCalledWith({ to: "/organization" });
  });

  it("keeps workspace setup and user settings reachable for workspace-less sessions", async () => {
    const access = await import("@/domains/access/server");
    const session = createAtlasSessionFixture({
      workspace: createAtlasWorkspace({
        activeOrganization: null,
        memberships: [],
        onboarding: { needsWorkspace: true },
      }),
    });
    vi.mocked(access.requireReadyAtlasSession).mockResolvedValue(session);

    const routeModule = await import("@/routes/_workspace");
    const { asRouteStub, readRouterMocks } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    if (!Route.options.beforeLoad) throw new Error("Expected beforeLoad");
    await expect(
      Route.options.beforeLoad({ location: { href: "/organization" } }),
    ).resolves.toEqual({ session });
    await expect(Route.options.beforeLoad({ location: { href: "/account" } })).resolves.toEqual({
      session,
    });
    expect(readRouterMocks().redirect).not.toHaveBeenCalled();
  });

  it("seeds the session hook with the ready session from route context", async () => {
    const initialSession = createAtlasSessionFixture({ isLocal: true });
    const { readRouterMocks } = await import("@/../tests/helpers/router-harness");
    readRouterMocks().useRouteContext.mockReturnValue({ session: initialSession });
    const { useAtlasSession } = await import("@/domains/access");
    vi.mocked(useAtlasSession).mockReturnValue({
      data: initialSession,
    } as unknown as ReturnType<typeof useAtlasSession>);

    const routeModule = await import("@/routes/_workspace");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);

    expect(useAtlasSession).toHaveBeenCalledWith({ initialData: initialSession });
  });
});
