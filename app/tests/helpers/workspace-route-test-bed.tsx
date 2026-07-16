import type { ComponentType, ReactNode } from "react";
import { render } from "@testing-library/react";
import { vi } from "vitest";

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

export async function loadWorkspaceRouteComponent(): Promise<ComponentType> {
  const routeModule = await import("@/routes/_workspace");
  const { asRouteStub } = await import("@/../tests/helpers/router-harness");
  const Route = asRouteStub(routeModule.Route);
  const Component = Route.options.component;
  if (!Component) throw new Error("Expected Route.options.component");
  return Component;
}

export function renderWorkspaceRoute(Component: ComponentType): void {
  render(<Component />);
}
