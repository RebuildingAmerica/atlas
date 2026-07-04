// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CoverageTargetCollection } from "@/domains/workspace/server/coverage-targets";

const mocks = vi.hoisted(() => ({
  loadWorkspaceCoverage: vi.fn(),
}));

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/workspace/server/coverage-targets", () => ({
  loadWorkspaceCoverage: mocks.loadWorkspaceCoverage,
}));

vi.mock("@/domains/workspace/pages/coverage-page", () => ({
  CoveragePage: ({
    initialCoverageTargets,
    orgId,
  }: {
    initialCoverageTargets: CoverageTargetCollection;
    orgId: string;
  }) => (
    <div
      data-testid="coverage-page"
      data-org-id={orgId}
      data-total={initialCoverageTargets.total}
    />
  ),
}));

describe("routes/_workspace/coverage", () => {
  function collection(): CoverageTargetCollection {
    return {
      items: [],
      total: 0,
    };
  }

  beforeEach(async () => {
    const { resetRouterMocks } = await import("@/../tests/helpers/router-harness");
    resetRouterMocks();
    mocks.loadWorkspaceCoverage.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("loads workspace coverage targets through the server helper", async () => {
    const data = collection();
    mocks.loadWorkspaceCoverage.mockResolvedValue({ coverageTargets: data, orgId: "org_123" });

    const routeModule = await import("@/routes/_workspace/coverage");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    if (!Route.options.loader) throw new Error("Expected loader");
    const result = (await Route.options.loader({})) as {
      coverageWorkspace: { coverageTargets: CoverageTargetCollection; orgId: string };
    };

    expect(result.coverageWorkspace).toEqual({ coverageTargets: data, orgId: "org_123" });
    expect(mocks.loadWorkspaceCoverage).toHaveBeenCalledWith();
  });

  it("renders the coverage page with loader data", async () => {
    const routeModule = await import("@/routes/_workspace/coverage");
    const { asRouteStub, readRouterMocks } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    readRouterMocks().useLoaderData.mockReturnValue({
      coverageWorkspace: { coverageTargets: collection(), orgId: "org_123" },
    });

    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);

    expect(screen.getByTestId("coverage-page")).toHaveAttribute("data-total", "0");
    expect(screen.getByTestId("coverage-page")).toHaveAttribute("data-org-id", "org_123");
  });
});
