// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  workspaceCoverageQueryOptions: vi.fn(),
}));

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/workspace/hooks/use-coverage-targets", () => ({
  workspaceCoverageQueryOptions: mocks.workspaceCoverageQueryOptions,
}));

vi.mock("@/domains/workspace/pages/coverage-page", () => ({
  CoveragePage: () => <div data-testid="coverage-page" />,
}));

describe("routes/_workspace/coverage", () => {
  beforeEach(async () => {
    const { resetRouterMocks } = await import("@/../tests/helpers/router-harness");
    resetRouterMocks();
    mocks.workspaceCoverageQueryOptions.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("seeds workspace coverage through the router context", async () => {
    const data = { coverageTargets: { items: [], total: 0 }, orgId: "org_123" };
    const queryOptions = { queryKey: ["workspace", "coverage-targets", "workspace"] };
    const ensureQueryData = vi.fn().mockResolvedValue(data);
    mocks.workspaceCoverageQueryOptions.mockReturnValue(queryOptions);

    const routeModule = await import("@/routes/_workspace/coverage");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    if (!Route.options.loader) throw new Error("Expected loader");
    const result = await Route.options.loader({ context: { queryClient: { ensureQueryData } } });

    expect(result).toBeUndefined();
    expect(mocks.workspaceCoverageQueryOptions).toHaveBeenCalledWith();
    expect(ensureQueryData).toHaveBeenCalledWith(queryOptions);
  });

  it("sets the coverage workspace page title", async () => {
    const routeModule = await import("@/routes/_workspace/coverage");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    expect(Route.options.head?.({})).toEqual({
      meta: [{ title: "Coverage Workspace | Atlas" }],
    });
  });

  it("renders the coverage page", async () => {
    const routeModule = await import("@/routes/_workspace/coverage");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);

    expect(screen.getByTestId("coverage-page")).toBeInTheDocument();
  });
});
