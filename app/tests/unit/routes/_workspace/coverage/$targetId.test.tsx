// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CoverageTargetDetail } from "@/domains/workspace/server/coverage-targets";
import type { WorkspaceFirehoseSourceTargetCollection } from "@/domains/workspace/server/firehose";

const mocks = vi.hoisted(() => ({
  loadWorkspaceFirehoseSourceTargets: vi.fn(),
  loadWorkspaceCoverageTargetDetail: vi.fn(),
}));

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/workspace/server/coverage-targets", () => ({
  loadWorkspaceCoverageTargetDetail: mocks.loadWorkspaceCoverageTargetDetail,
}));

vi.mock("@/domains/workspace/server/firehose", () => ({
  loadWorkspaceFirehoseSourceTargets: mocks.loadWorkspaceFirehoseSourceTargets,
}));

vi.mock("@/domains/workspace/pages/coverage-detail-page", () => ({
  CoverageDetailPage: ({
    detail,
    sourceTargets,
  }: {
    detail: CoverageTargetDetail;
    sourceTargets: WorkspaceFirehoseSourceTargetCollection;
  }) => (
    <div
      data-testid="coverage-detail-page"
      data-source-targets={String(sourceTargets.total)}
      data-target-id={detail.target.id}
    />
  ),
}));

describe("routes/_workspace/coverage/$targetId", () => {
  function detail(): CoverageTargetDetail {
    return {
      discovery_runs: [],
      entries: [],
      target: {
        actor_types: ["organization"],
        created_at: "2026-07-01T00:00:00.000Z",
        created_by: "operator_1",
        gaps: [],
        geography: "Kansas City, MO",
        id: "coverage_123",
        issue_areas: ["housing_affordability"],
        last_reviewed_at: null,
        last_run_at: null,
        linked_discovery_run_ids: [],
        linked_entry_ids: [],
        name: "Kansas City tenant power",
        next_actions: [],
        org_id: "org_123",
        records_found: 0,
        review_state: "needs_research",
        source_types: ["community_archive"],
        sources_reviewed: 0,
        status: "unknown",
        status_reason: "No linked discovery runs or records yet.",
        updated_at: "2026-07-02T00:00:00.000Z",
      },
    };
  }

  beforeEach(async () => {
    const { resetRouterMocks } = await import("@/../tests/helpers/router-harness");
    resetRouterMocks();
    mocks.loadWorkspaceFirehoseSourceTargets.mockReset();
    mocks.loadWorkspaceCoverageTargetDetail.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("loads target detail through the workspace server helper", async () => {
    const data = detail();
    const sourceTargets = { items: [], total: 0 };
    mocks.loadWorkspaceCoverageTargetDetail.mockResolvedValue(data);
    mocks.loadWorkspaceFirehoseSourceTargets.mockResolvedValue(sourceTargets);

    const routeModule = await import("@/routes/_workspace/coverage/$targetId");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    if (!Route.options.loader) throw new Error("Expected loader");
    const result = (await Route.options.loader({ params: { targetId: "coverage_123" } })) as {
      coverageTargetDetail: CoverageTargetDetail;
      sourceTargets: WorkspaceFirehoseSourceTargetCollection;
    };

    expect(result.coverageTargetDetail).toBe(data);
    expect(result.sourceTargets).toBe(sourceTargets);
    expect(mocks.loadWorkspaceCoverageTargetDetail).toHaveBeenCalledWith({
      data: { targetId: "coverage_123" },
    });
    expect(mocks.loadWorkspaceFirehoseSourceTargets).toHaveBeenCalledWith({
      data: { coverageTargetId: "coverage_123" },
    });
  });

  it("renders the detail page with loader data", async () => {
    const routeModule = await import("@/routes/_workspace/coverage/$targetId");
    const { asRouteStub, readRouterMocks } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    readRouterMocks().useLoaderData.mockReturnValue({
      coverageTargetDetail: detail(),
      sourceTargets: { items: [], total: 0 },
    });

    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);

    expect(screen.getByTestId("coverage-detail-page")).toHaveAttribute(
      "data-target-id",
      "coverage_123",
    );
    expect(screen.getByTestId("coverage-detail-page")).toHaveAttribute("data-source-targets", "0");
  });
});
