import type { ReactNode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { createAtlasSessionFixture } from "@/../tests/fixtures/access/sessions";

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
    identitySlot: React.ReactNode;
    children: React.ReactNode;
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

export async function setupWorkspaceRouteTest(): Promise<void> {
  await import("@/routes/_workspace");
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
}

export async function renderWorkspaceRoute(): Promise<void> {
  const routeModule = await import("@/routes/_workspace");
  const { asRouteStub } = await import("@/../tests/helpers/router-harness");
  const Route = asRouteStub(routeModule.Route);
  const Component = Route.options.component;
  if (!Component) throw new Error("Expected Route.options.component");
  render(<Component />);
}

export function workspaceRailLabels(): string[] {
  const railItems = JSON.parse(
    screen.getByTestId("workspace-layout").dataset.railItems ?? "[]",
  ) as { label: string }[];
  return railItems.map((item) => item.label);
}

export async function changeWorkspace(): Promise<void> {
  await act(async () => {
    fireEvent.change(screen.getByLabelText("workspace-select"), {
      target: { value: "org_1" },
    });
    await Promise.resolve();
  });
}

export function workspaceSession(
  options: {
    activeOrganization?: { id: string; name: string; workspaceType: "individual" | "team" } | null;
    canSwitchOrganizations?: boolean;
    hasPendingInvitations?: boolean;
    memberships?: { id: string; name: string }[];
    name?: string;
    needsWorkspace?: boolean;
    workspaceType?: "individual" | "team";
  } = {},
) {
  const workspaceType = options.workspaceType ?? "individual";
  return {
    isLocal: false,
    user: { id: "u1", name: options.name ?? "Op", email: "ops@acme.test" },
    workspace: {
      activeOrganization:
        options.activeOrganization === undefined
          ? { id: "org_1", name: "Acme", workspaceType }
          : options.activeOrganization,
      memberships: options.memberships ?? [{ id: "org_1", name: "Acme" }],
      onboarding: {
        needsWorkspace: options.needsWorkspace ?? false,
        hasPendingInvitations: options.hasPendingInvitations ?? false,
      },
      capabilities: { canSwitchOrganizations: options.canSwitchOrganizations ?? false },
    },
  };
}
