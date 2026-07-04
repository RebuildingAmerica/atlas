// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AtlasBriefExport } from "@/domains/workspace/server/briefs";

const mocks = vi.hoisted(() => ({
  loadWorkspaceBriefExport: vi.fn(),
}));

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/workspace/server/briefs", () => ({
  loadWorkspaceBriefExport: mocks.loadWorkspaceBriefExport,
}));

vi.mock("@/domains/workspace/pages/brief-detail-page", () => ({
  BriefDetailPage: ({ briefExport }: { briefExport: AtlasBriefExport }) => (
    <div data-testid="brief-detail" data-title={briefExport.brief.title} />
  ),
}));

describe("routes/_workspace/briefs/$briefId", () => {
  function briefExport(): AtlasBriefExport {
    return {
      format: "json",
      brief: {
        id: "brief_123",
        org_id: "org_123",
        title: "Tenant Power Brief",
        scope: {
          geography: "Kansas City, MO",
          issue_areas: ["housing"],
          actor_types: ["organization"],
          source_types: ["news"],
        },
        summary: "A source-linked brief.",
        linked_entry_ids: [],
        linked_source_ids: [],
        linked_discovery_run_ids: [],
        confidence_summary: {
          source_count: 1,
          state: "partial",
          review_status: "reviewed",
        },
        gaps: [],
        created_by: "operator_1",
        created_at: "2026-07-03T10:00:00.000Z",
        updated_at: "2026-07-03T10:00:00.000Z",
      },
      entries: [],
      sources: [],
      discovery_runs: [],
      provenance: {
        source_count: 0,
        entry_count: 0,
        discovery_run_count: 0,
        confidence_state: "partial",
        review_status: "reviewed",
      },
    };
  }

  beforeEach(async () => {
    const { resetRouterMocks } = await import("@/../tests/helpers/router-harness");
    resetRouterMocks();
    mocks.loadWorkspaceBriefExport.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("loads the brief export through the workspace server helper", async () => {
    const data = briefExport();
    mocks.loadWorkspaceBriefExport.mockResolvedValue(data);

    const routeModule = await import("@/routes/_workspace/briefs.$briefId");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    if (!Route.options.loader) throw new Error("Expected loader");
    const result = (await Route.options.loader({ params: { briefId: "brief_123" } })) as {
      briefExport: AtlasBriefExport;
    };

    expect(result.briefExport).toBe(data);
    expect(mocks.loadWorkspaceBriefExport).toHaveBeenCalledWith({
      data: { briefId: "brief_123" },
    });
  });

  it("renders the brief detail page with loader data", async () => {
    const routeModule = await import("@/routes/_workspace/briefs.$briefId");
    const { asRouteStub, readRouterMocks } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    readRouterMocks().useLoaderData.mockReturnValue({ briefExport: briefExport() });

    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);

    expect(screen.getByTestId("brief-detail")).toHaveAttribute("data-title", "Tenant Power Brief");
  });
});
