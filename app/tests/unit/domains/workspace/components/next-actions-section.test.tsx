// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextActionsSection } from "@/domains/workspace/components/next-actions-section";
import type { NextActionsWorkspaceState } from "@/domains/workspace/components/next-actions-section";
import type { ResearchSummary } from "@/domains/workspace/server/research-summary";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

describe("NextActionsSection", () => {
  afterEach(() => {
    cleanup();
  });

  function emptySummary(): ResearchSummary {
    return {
      lists: [],
      activity: { newSourcesThisWeek: 0, recentItems: [], followedActorCount: 0 },
      recentRuns: [],
      totals: { savedActors: 0, listCount: 0, runsThisMonth: 0 },
      watchlists: [],
    };
  }

  function fullSummary(): ResearchSummary {
    return {
      lists: [{ id: "list_1", name: "Climate", description: null, itemCount: 2 }],
      activity: { newSourcesThisWeek: 1, recentItems: [], followedActorCount: 3 },
      recentRuns: [
        {
          id: "r1",
          locationQuery: "Kansas City, MO",
          state: "MO",
          status: "completed",
          startedAt: "2026-06-20T00:00:00.000Z",
          issueAreas: ["housing_affordability"],
        },
      ],
      totals: { savedActors: 2, listCount: 1, runsThisMonth: 1 },
      watchlists: [],
    };
  }

  function workspaceState(
    overrides?: Partial<NextActionsWorkspaceState>,
  ): NextActionsWorkspaceState {
    return {
      briefs: { data: { items: [], total: 0 }, status: "ready" },
      coverageTargets: { data: { items: [], total: 0 }, status: "ready" },
      showRenewalProof: true,
      usageSummary: {
        data: {
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
        },
        status: "ready",
      },
      watches: { data: { items: [], orgId: "org_123", total: 0 }, status: "ready" },
      ...overrides,
    };
  }

  it("offers all three suggestions for a brand-new research base", () => {
    render(<NextActionsSection summary={emptySummary()} />);

    expect(screen.getByRole("link", { name: "Browse profiles" })).toHaveAttribute(
      "data-link-to",
      "/profiles",
    );
    expect(screen.getByRole("link", { name: "Start a list" })).toHaveAttribute(
      "data-link-to",
      "/lists",
    );
    expect(screen.getByRole("link", { name: "Start research" })).toHaveAttribute(
      "data-link-to",
      "/discovery",
    );
  });

  it("hides the follow suggestion once the user already follows an actor", () => {
    const summary = emptySummary();
    summary.activity.followedActorCount = 1;
    render(<NextActionsSection summary={summary} />);

    expect(screen.queryByRole("link", { name: "Browse profiles" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start a list" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start research" })).toBeInTheDocument();
  });

  it("renders nothing when every suggestion is already satisfied", () => {
    const { container } = render(<NextActionsSection summary={fullSummary()} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("continues the workspace workflow after the first research base exists", () => {
    render(<NextActionsSection summary={fullSummary()} workspace={workspaceState()} />);

    expect(screen.getByRole("link", { name: "New brief" })).toHaveAttribute(
      "data-link-to",
      "/briefs/new",
    );
    expect(screen.getByRole("link", { name: "Open coverage" })).toHaveAttribute(
      "data-link-to",
      "/coverage",
    );
    expect(screen.getByRole("link", { name: "Choose monitoring" })).toHaveAttribute(
      "data-link-to",
      "/coverage",
    );
    expect(screen.queryByRole("link", { name: "Start research" })).not.toBeInTheDocument();
  });

  it("points completed workspace workflows toward renewal proof", () => {
    render(
      <NextActionsSection
        summary={fullSummary()}
        workspace={workspaceState({
          briefs: { data: { items: [], total: 1 }, status: "ready" },
          coverageTargets: { data: { items: [], total: 1 }, status: "ready" },
          usageSummary: {
            data: {
              event_counts: { brief_opened: 1 },
              org_id: "org_123",
              renewal_signals: {
                briefs_used: 1,
                coverage_gaps_closed: 0,
                integrations_used: 0,
                public_records_improved: 1,
                team_workflow_actions: 1,
              },
              total_events: 3,
            },
            status: "ready",
          },
          watches: { data: { items: [], orgId: "org_123", total: 1 }, status: "ready" },
        })}
      />,
    );

    const proofLink = screen.getByRole("link", { name: "Open proof" });
    expect(proofLink).toHaveAttribute("data-link-to", "/organization");
    expect(proofLink).toHaveAttribute("data-link-hash", "renewal-proof");
    expect(screen.queryByRole("link", { name: "New brief" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open coverage" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Choose monitoring" })).not.toBeInTheDocument();
  });

  it("does not send personal workspaces toward team renewal proof", () => {
    render(
      <NextActionsSection
        summary={fullSummary()}
        workspace={workspaceState({
          briefs: { data: { items: [], total: 1 }, status: "ready" },
          coverageTargets: { data: { items: [], total: 1 }, status: "ready" },
          showRenewalProof: false,
          usageSummary: {
            data: {
              event_counts: { brief_opened: 1 },
              org_id: "org_123",
              renewal_signals: {
                briefs_used: 1,
                coverage_gaps_closed: 0,
                integrations_used: 0,
                public_records_improved: 1,
                team_workflow_actions: 1,
              },
              total_events: 3,
            },
            status: "ready",
          },
          watches: { data: { items: [], orgId: "org_123", total: 1 }, status: "ready" },
        })}
      />,
    );

    expect(screen.queryByRole("link", { name: "Open proof" })).not.toBeInTheDocument();
  });
});
