// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  workspaceWatchesQueryOptions: vi.fn(),
}));

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/workspace/hooks/use-workspace-watches", () => ({
  workspaceWatchesQueryOptions: mocks.workspaceWatchesQueryOptions,
}));

vi.mock("@/domains/workspace/pages/watches-page", () => ({
  WorkspaceWatchesPage: () => <div data-testid="watches-page" />,
}));

describe("routes/_workspace/watching", () => {
  beforeEach(async () => {
    const { resetRouterMocks } = await import("@/../tests/helpers/router-harness");
    resetRouterMocks();
    mocks.workspaceWatchesQueryOptions.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("seeds shared workspace watches through the router context", async () => {
    const data = { items: [], orgId: "org_123", total: 0 };
    const queryOptions = { queryKey: ["workspace", "watches", "list"] };
    const ensureQueryData = vi.fn().mockResolvedValue(data);
    mocks.workspaceWatchesQueryOptions.mockReturnValue(queryOptions);

    const routeModule = await import("@/routes/_workspace/watching");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    if (!Route.options.loader) throw new Error("Expected loader");
    const result = await Route.options.loader({ context: { queryClient: { ensureQueryData } } });

    expect(result).toBe(data);
    expect(mocks.workspaceWatchesQueryOptions).toHaveBeenCalledWith();
    expect(ensureQueryData).toHaveBeenCalledWith(queryOptions);
  });

  it("sets the watching page title", async () => {
    const routeModule = await import("@/routes/_workspace/watching");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    expect(Route.options.head?.({})).toEqual({
      meta: [{ title: "Watching | Atlas" }],
    });
  });

  it("renders the watches page", async () => {
    const routeModule = await import("@/routes/_workspace/watching");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);

    expect(screen.getByTestId("watches-page")).toBeInTheDocument();
  });
});
