// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceWatchCollection } from "@/domains/workspace/server/watches";

const mocks = vi.hoisted(() => ({
  loadWorkspaceWatches: vi.fn(),
}));

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/workspace/server/watches", () => ({
  loadWorkspaceWatches: mocks.loadWorkspaceWatches,
}));

vi.mock("@/domains/workspace/pages/watches-page", () => ({
  WorkspaceWatchesPage: ({ initialWatches }: { initialWatches: WorkspaceWatchCollection }) => (
    <div data-testid="watches-page" data-total={initialWatches.total} />
  ),
}));

describe("routes/_workspace/watching", () => {
  function collection(): WorkspaceWatchCollection {
    return {
      items: [],
      orgId: "org_123",
      total: 0,
    };
  }

  beforeEach(async () => {
    const { resetRouterMocks } = await import("@/../tests/helpers/router-harness");
    resetRouterMocks();
    mocks.loadWorkspaceWatches.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("loads shared workspace watches through the server helper", async () => {
    const data = collection();
    mocks.loadWorkspaceWatches.mockResolvedValue(data);

    const routeModule = await import("@/routes/_workspace/watching");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    if (!Route.options.loader) throw new Error("Expected loader");
    const result = (await Route.options.loader({})) as {
      workspaceWatches: WorkspaceWatchCollection;
    };

    expect(result.workspaceWatches).toBe(data);
    expect(mocks.loadWorkspaceWatches).toHaveBeenCalledWith();
  });

  it("sets the watching page title", async () => {
    const routeModule = await import("@/routes/_workspace/watching");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    expect(Route.options.head?.({})).toEqual({
      meta: [{ title: "Watching | Atlas" }],
    });
  });

  it("renders the watches page with loader data", async () => {
    const routeModule = await import("@/routes/_workspace/watching");
    const { asRouteStub, readRouterMocks } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    readRouterMocks().useLoaderData.mockReturnValue({
      workspaceWatches: collection(),
    });

    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);

    expect(screen.getByTestId("watches-page")).toHaveAttribute("data-total", "0");
  });
});
