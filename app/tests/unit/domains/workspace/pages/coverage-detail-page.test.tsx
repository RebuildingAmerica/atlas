// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoverageDetailPage } from "@/domains/workspace/pages/coverage-detail-page";
import type { CoverageTargetDetail } from "@/domains/workspace/server/coverage-targets";
import type { WorkspaceFirehoseSourceTargetCollection } from "@/domains/workspace/server/firehose";

const mocks = vi.hoisted(() => ({
  unwatchWorkspaceResource: vi.fn(),
  useUnwatchWorkspaceResource: vi.fn(),
  useWatchWorkspaceResource: vi.fn(),
  useWorkspaceWatchStatus: vi.fn(),
  watchWorkspaceResource: vi.fn(),
}));

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/workspace/hooks/use-workspace-watches", () => ({
  useUnwatchWorkspaceResource: mocks.useUnwatchWorkspaceResource,
  useWatchWorkspaceResource: mocks.useWatchWorkspaceResource,
  useWorkspaceWatchStatus: mocks.useWorkspaceWatchStatus,
}));

describe("CoverageDetailPage", () => {
  beforeEach(() => {
    mocks.unwatchWorkspaceResource.mockReset();
    mocks.useUnwatchWorkspaceResource.mockReset();
    mocks.useWatchWorkspaceResource.mockReset();
    mocks.useWorkspaceWatchStatus.mockReset();
    mocks.watchWorkspaceResource.mockReset();
    mocks.useWorkspaceWatchStatus.mockReturnValue({
      data: { watched: false, watch: null },
      isLoading: false,
    });
    mocks.useWatchWorkspaceResource.mockReturnValue({
      isPending: false,
      mutate: mocks.watchWorkspaceResource,
    });
    mocks.useUnwatchWorkspaceResource.mockReturnValue({
      isPending: false,
      mutate: mocks.unwatchWorkspaceResource,
    });
  });

  afterEach(() => {
    cleanup();
  });

  function detail(): CoverageTargetDetail {
    return {
      discovery_runs: [
        {
          completed_at: "2026-07-02T00:10:00.000Z",
          entries_confirmed: 1,
          id: "run_123",
          issue_areas: ["housing_affordability"],
          location_query: "Kansas City, MO",
          research_goal: "coverage_review",
          sources_processed: 1,
          started_at: "2026-07-02T00:00:00.000Z",
          state: "MO",
          status: "completed",
        },
      ],
      entries: [
        {
          city: "Kansas City",
          id: "entry_123",
          name: "KC Tenants",
          slug: "kc-tenants",
          source_count: 1,
          sources: [
            {
              id: "source_123",
              publication: "Community Archive",
              title: "Tenant hotline archive",
              type: "community_archive",
              url: "https://example.test/kc-tenants",
            },
          ],
          state: "MO",
          type: "organization",
        },
      ],
      target: {
        actor_types: ["organization"],
        created_at: "2026-07-01T00:00:00.000Z",
        created_by: "operator_1",
        gaps: [
          {
            detail: "Review county-level tenant organizations.",
            label: "County tenant groups",
          },
        ],
        geography: "Kansas City, MO",
        id: "coverage_123",
        issue_areas: ["housing_affordability"],
        last_reviewed_at: "2026-07-02T00:00:00.000Z",
        last_run_at: "2026-07-02T00:10:00.000Z",
        linked_discovery_run_ids: ["run_123"],
        linked_entry_ids: ["entry_123"],
        name: "Kansas City tenant power",
        next_actions: ["Review county source coverage"],
        org_id: "org_123",
        records_found: 1,
        review_state: "in_review",
        source_types: ["community_archive"],
        sources_reviewed: 1,
        status: "thin",
        status_reason: "Coverage has fewer than 3 records or sources.",
        updated_at: "2026-07-02T00:00:00.000Z",
      },
    };
  }

  function sourceTargets(): WorkspaceFirehoseSourceTargetCollection {
    return {
      items: [
        {
          cadence_seconds: 60,
          content_hash: null,
          coverage_target_id: "coverage_123",
          created_at: "2026-07-07T16:00:00Z",
          created_by: "operator_1",
          enabled: true,
          etag: null,
          id: "source_target_123",
          issues: ["housing_affordability"],
          label: "Kansas City housing agenda",
          last_checked_at: null,
          last_error: null,
          last_http_status: null,
          last_modified: null,
          last_success_at: null,
          org_id: "org_123",
          origin: "api",
          origin_note: null,
          places: ["kansas-city-mo"],
          priority: "hot",
          public_route_enabled: true,
          safety_policy: "standard",
          source_class: "government_agenda",
          source_kind: "rss",
          updated_at: "2026-07-07T16:00:00Z",
          url: "https://example.test/kc-agenda.xml",
        },
      ],
      total: 1,
    };
  }

  it("renders target evidence and routes thin coverage into prefilled research", () => {
    render(<CoverageDetailPage detail={detail()} sourceTargets={sourceTargets()} />);

    expect(screen.getByRole("heading", { name: "Kansas City tenant power" })).toBeInTheDocument();
    expect(screen.getByText("Thin")).toBeInTheDocument();
    expect(screen.getByText("In review")).toBeInTheDocument();
    expect(screen.getByText("Fewer than 3 records or sources.")).toBeInTheDocument();
    expect(screen.getAllByText("Kansas City, MO").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1 record").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1 source").length).toBeGreaterThan(0);
    expect(screen.getByText("County tenant groups")).toBeInTheDocument();
    expect(screen.getByText("Review county-level tenant organizations.")).toBeInTheDocument();
    expect(screen.getByText("Review county source coverage")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Linked research" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Firehose sources" })).toBeInTheDocument();
    expect(screen.getByText("Kansas City housing agenda")).toBeInTheDocument();
    expect(screen.getByText(/government agenda/)).toBeInTheDocument();
    expect(screen.getByText("Public route")).toBeInTheDocument();
    expect(screen.getByText("Not checked")).toBeInTheDocument();
    expect(screen.getByText("coverage review")).toBeInTheDocument();
    expect(screen.queryByText(/discovery run/i)).not.toBeInTheDocument();
    expect(mocks.useWorkspaceWatchStatus).toHaveBeenCalledWith(
      {
        resourceId: "coverage_123",
        resourceType: "coverage_target",
      },
      true,
      "org_123",
    );

    const actorLink = screen.getByRole("link", { name: "KC Tenants" });
    expect(actorLink).toHaveAttribute("data-link-to", "/profiles/organizations/$slug");
    expect(actorLink).toHaveAttribute("data-link-params", JSON.stringify({ slug: "kc-tenants" }));

    const sourceLink = screen.getByRole("link", { name: "Tenant hotline archive" });
    expect(sourceLink).toHaveAttribute("href", "https://example.test/kc-tenants");

    const researchLink = screen.getByRole("link", { name: "Research this gap" });
    expect(researchLink).toHaveAttribute("data-link-to", "/discovery");
    expect(researchLink).toHaveAttribute(
      "data-link-search",
      JSON.stringify({
        issue_areas: "housing_affordability",
        location: "Kansas City, MO",
        research_goal: "partner_scan",
        state: "MO",
      }),
    );

    expect(screen.getByRole("button", { name: "Watch target" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Watch target" }));
    expect(mocks.watchWorkspaceResource).toHaveBeenCalledWith({
      resourceId: "coverage_123",
      resourceType: "coverage_target",
    });
  });

  it("unwatches a watched target", () => {
    mocks.useWorkspaceWatchStatus.mockReturnValue({
      data: {
        watched: true,
        watch: {
          id: "watch_123",
          resource_id: "coverage_123",
          resource_type: "coverage_target",
        },
      },
      isLoading: false,
    });

    render(<CoverageDetailPage detail={detail()} sourceTargets={sourceTargets()} />);

    fireEvent.click(screen.getByRole("button", { name: "Watching" }));
    expect(mocks.unwatchWorkspaceResource).toHaveBeenCalledWith({
      resourceId: "coverage_123",
      resourceType: "coverage_target",
    });
  });

  it("keeps empty evidence states plain", () => {
    const emptyDetail = detail();
    emptyDetail.discovery_runs = [];
    emptyDetail.entries = [];
    emptyDetail.target.gaps = [];
    emptyDetail.target.next_actions = [];

    render(<CoverageDetailPage detail={emptyDetail} sourceTargets={{ items: [], total: 0 }} />);

    const evidence = screen.getByTestId("coverage-detail-evidence");
    expect(within(evidence).getByText("No linked research yet.")).toBeInTheDocument();
    expect(within(evidence).getByText("No linked actors yet.")).toBeInTheDocument();
    expect(screen.getByText("No Firehose sources listed.")).toBeInTheDocument();
    expect(screen.getByText("No gaps listed.")).toBeInTheDocument();
    expect(screen.getByText("No next actions listed.")).toBeInTheDocument();
  });

  it("keeps an unlinkable actor and an unfinished run readable", () => {
    const partialDetail = detail();
    const [partialRun] = partialDetail.discovery_runs;
    const [partialEntry] = partialDetail.entries;
    if (!partialRun || !partialEntry) {
      throw new Error("Expected the fixture to carry one run and one entry.");
    }
    partialRun.completed_at = null;
    partialEntry.slug = null;
    partialEntry.city = null;
    partialEntry.state = null;
    partialEntry.sources = [];
    mocks.useWorkspaceWatchStatus.mockReturnValue({ data: undefined, isLoading: false });

    render(<CoverageDetailPage detail={partialDetail} sourceTargets={sourceTargets()} />);

    expect(screen.getByRole("button", { name: "Watch target" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "KC Tenants" })).not.toBeInTheDocument();
    expect(screen.getByText("KC Tenants")).toBeInTheDocument();
    expect(screen.getByText("Location not listed")).toBeInTheDocument();
  });

  it("falls back to a source's publication, then its address, for a receipt with no headline", () => {
    const untitledDetail = detail();
    const [untitledEntry] = untitledDetail.entries;
    if (!untitledEntry) throw new Error("Expected the fixture to carry one entry.");
    untitledEntry.sources = [
      {
        id: "source_pub",
        publication: "Community Archive",
        title: null,
        type: "community_archive",
        url: "https://example.test/pub",
      },
      {
        id: "source_url",
        publication: null,
        title: null,
        type: "community_archive",
        url: "https://example.test/bare",
      },
    ];

    render(<CoverageDetailPage detail={untitledDetail} sourceTargets={sourceTargets()} />);

    expect(screen.getByRole("link", { name: /Community Archive/ })).toHaveAttribute(
      "href",
      "https://example.test/pub",
    );
    expect(screen.getByRole("link", { name: /https:\/\/example.test\/bare/ })).toBeInTheDocument();
  });
});
