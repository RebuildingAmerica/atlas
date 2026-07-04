// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceOperatingPictureSection } from "@/domains/workspace/components/workspace-operating-picture-section";
import type { OperatingPictureResource } from "@/domains/workspace/components/workspace-operating-picture-section";
import type { AtlasBriefCollection } from "@/domains/workspace/server/briefs";
import type {
  CoverageTarget,
  CoverageTargetCollection,
} from "@/domains/workspace/server/coverage-targets";
import type { WorkspaceUsageSummary } from "@/domains/workspace/server/usage-summary";
import type { WorkspaceWatchCollection } from "@/domains/workspace/server/watches";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, hash, to }: { children: ReactNode; hash?: string; to?: string }) => (
    <a href={`${to ?? ""}${hash ? `#${hash}` : ""}`} data-link-hash={hash} data-link-to={to}>
      {children}
    </a>
  ),
}));

describe("WorkspaceOperatingPictureSection", () => {
  afterEach(() => {
    cleanup();
  });

  function ready<TData>(data: TData): OperatingPictureResource<TData> {
    return { data, status: "ready" as const };
  }

  function loading<TData>(): OperatingPictureResource<TData> {
    return { data: null, status: "loading" as const };
  }

  function unavailable<TData>(): OperatingPictureResource<TData> {
    return { data: null, status: "unavailable" as const };
  }

  function briefCollection(): AtlasBriefCollection {
    return {
      total: 2,
      items: [],
    };
  }

  function coverageTarget(overrides: Partial<CoverageTarget>): CoverageTarget {
    return {
      actor_types: ["organization"],
      created_at: "2026-07-01T00:00:00.000Z",
      created_by: "operator_1",
      gaps: [],
      geography: "Kansas City, MO",
      id: "coverage_1",
      issue_areas: ["housing_affordability"],
      last_reviewed_at: "2026-07-02T00:00:00.000Z",
      last_run_at: "2026-07-02T00:00:00.000Z",
      linked_discovery_run_ids: ["run_1"],
      linked_entry_ids: ["entry_1"],
      name: "Kansas City tenant power",
      next_actions: [],
      org_id: "org_123",
      records_found: 1,
      review_state: "needs_research",
      source_types: ["news"],
      sources_reviewed: 1,
      status: "thin",
      status_reason: "Fewer than 3 records or sources.",
      updated_at: "2026-07-02T00:00:00.000Z",
      ...overrides,
    };
  }

  function coverageTargets(): CoverageTargetCollection {
    return {
      total: 2,
      items: [
        coverageTarget({
          id: "coverage_ready",
          name: "Ready coverage",
          review_state: "ready_for_delivery",
          status: "covered",
        }),
        coverageTarget({
          id: "coverage_thin",
          name: "Thin coverage",
        }),
      ],
    };
  }

  function watches(): WorkspaceWatchCollection {
    return {
      items: [],
      orgId: "org_123",
      total: 2,
    };
  }

  function usageSummary(): WorkspaceUsageSummary {
    return {
      event_counts: {
        brief_opened: 3,
        digest_viewed: 2,
      },
      org_id: "org_123",
      renewal_signals: {
        briefs_used: 3,
        coverage_gaps_closed: 1,
        integrations_used: 0,
        public_records_improved: 2,
        team_workflow_actions: 5,
      },
      total_events: 9,
    };
  }

  it("renders the paid workspace loop as one operating picture", () => {
    render(
      <WorkspaceOperatingPictureSection
        briefs={ready(briefCollection())}
        coverageTargets={ready(coverageTargets())}
        showRenewalProof={true}
        usageSummary={ready(usageSummary())}
        watches={ready(watches())}
        workspaceLabel="Team workspace"
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Workspace operating picture" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Team workspace")).toBeInTheDocument();
    expect(screen.getByText("2 briefs")).toBeInTheDocument();
    expect(screen.getByText("2 coverage targets")).toBeInTheDocument();
    expect(screen.getByText("1 ready, 1 needs work")).toBeInTheDocument();
    expect(screen.getByText("2 watched resources")).toBeInTheDocument();
    expect(screen.getByText("9 proof events")).toBeInTheDocument();
    expect(screen.getByText("2 public records improved")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open briefs" })).toHaveAttribute(
      "data-link-to",
      "/briefs",
    );
    expect(screen.getByRole("link", { name: "Open coverage" })).toHaveAttribute(
      "data-link-to",
      "/coverage",
    );
    expect(screen.getByRole("link", { name: "Open monitoring" })).toHaveAttribute(
      "data-link-to",
      "/watching",
    );
    expect(screen.getByRole("link", { name: "Open proof" })).toHaveAttribute(
      "data-link-to",
      "/organization",
    );
    expect(screen.getByRole("link", { name: "Open proof" })).toHaveAttribute(
      "data-link-hash",
      "renewal-proof",
    );
  });

  it("renders zero states without hiding the workflow surfaces", () => {
    render(
      <WorkspaceOperatingPictureSection
        briefs={ready({ items: [], total: 0 })}
        coverageTargets={ready({ items: [], total: 0 })}
        showRenewalProof={true}
        usageSummary={ready({
          event_counts: {},
          org_id: "org_123",
          renewal_signals: {
            briefs_used: 0,
            coverage_gaps_closed: 0,
            integrations_used: 0,
            public_records_improved: 0,
            team_workflow_actions: 0,
          },
          total_events: 0,
        })}
        watches={ready({ items: [], orgId: "org_123", total: 0 })}
        workspaceLabel="Team workspace"
      />,
    );

    expect(screen.getByText("0 briefs")).toBeInTheDocument();
    expect(screen.getByText("0 coverage targets")).toBeInTheDocument();
    expect(screen.getByText("0 watched resources")).toBeInTheDocument();
    expect(screen.getByText("No proof events yet.")).toBeInTheDocument();
  });

  it("does not present loading workspace data as zero activity", () => {
    render(
      <WorkspaceOperatingPictureSection
        briefs={loading<AtlasBriefCollection>()}
        coverageTargets={loading<CoverageTargetCollection>()}
        showRenewalProof={true}
        usageSummary={loading<WorkspaceUsageSummary>()}
        watches={loading<WorkspaceWatchCollection>()}
        workspaceLabel="Team workspace"
      />,
    );

    expect(screen.getAllByText("Loading")).toHaveLength(6);
    expect(screen.queryByText("0 briefs")).not.toBeInTheDocument();
    expect(screen.queryByText("No proof events yet.")).not.toBeInTheDocument();
  });

  it("names unavailable workspace lanes without presenting them as loading or empty", () => {
    render(
      <WorkspaceOperatingPictureSection
        briefs={unavailable<AtlasBriefCollection>()}
        coverageTargets={unavailable<CoverageTargetCollection>()}
        showRenewalProof={true}
        usageSummary={unavailable<WorkspaceUsageSummary>()}
        watches={unavailable<WorkspaceWatchCollection>()}
        workspaceLabel="Team workspace"
      />,
    );

    expect(screen.getAllByText("Unavailable")).toHaveLength(4);
    expect(screen.getByText("Briefs could not load.")).toBeInTheDocument();
    expect(screen.getByText("Coverage could not load.")).toBeInTheDocument();
    expect(screen.getByText("Monitoring could not load.")).toBeInTheDocument();
    expect(screen.getByText("Proof could not load.")).toBeInTheDocument();
    expect(screen.queryByText("Loading")).not.toBeInTheDocument();
    expect(screen.queryByText("0 briefs")).not.toBeInTheDocument();
    expect(screen.queryByText("No proof events yet.")).not.toBeInTheDocument();
  });

  it("labels individual workspace operating pictures as personal", () => {
    render(
      <WorkspaceOperatingPictureSection
        briefs={ready(briefCollection())}
        coverageTargets={ready(coverageTargets())}
        showRenewalProof={false}
        usageSummary={ready(usageSummary())}
        watches={ready(watches())}
        workspaceLabel="Personal workspace"
      />,
    );

    expect(screen.getByText("Personal workspace")).toBeInTheDocument();
    expect(screen.queryByText("Team workspace")).not.toBeInTheDocument();
    expect(screen.queryByText("Renewal proof")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open proof" })).not.toBeInTheDocument();
  });
});
