// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { ReactNode } from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResearchHomePage } from "@/domains/workspace/pages/research-home-page";
import type { ResearchSummary } from "@/domains/workspace/server/research-summary";
import type { AtlasSessionPayload } from "@rebuildingamerica/atlas-access/workspace/organization-contracts";
import type { NextActionsWorkspaceState } from "@/domains/workspace/components/next-actions-section";
import type { AtlasBriefCollection } from "@/domains/workspace/server/briefs";
import type { CoverageTargetCollection } from "@/domains/workspace/server/coverage-targets";
import type { WorkspaceUsageSummary } from "@/domains/workspace/server/usage-summary";
import type { WorkspaceWatchCollection } from "@/domains/workspace/server/watches";

const mocks = vi.hoisted(() => ({
  useResearchSummary: vi.fn(),
  useAtlasSession: vi.fn(),
  useWorkspaceBriefs: vi.fn(),
  useWorkspaceCoverageTargets: vi.fn(),
  useWorkspaceUsageSummary: vi.fn(),
  useWorkspaceWatchesSnapshot: vi.fn(),
}));

vi.mock("@/domains/workspace/hooks/use-research-summary", () => ({
  useResearchSummary: mocks.useResearchSummary,
}));

vi.mock("@/domains/access", () => ({
  useAtlasSession: mocks.useAtlasSession,
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: ReactNode; to?: string }) => (
    <a href={to} data-link-to={to}>
      {children}
    </a>
  ),
}));

vi.mock("@/domains/workspace/hooks/use-briefs", () => ({
  useWorkspaceBriefs: mocks.useWorkspaceBriefs,
}));

vi.mock("@/domains/workspace/hooks/use-coverage-targets", () => ({
  useWorkspaceCoverageTargets: mocks.useWorkspaceCoverageTargets,
}));

vi.mock("@/domains/workspace/hooks/use-workspace-usage-summary", () => ({
  useWorkspaceUsageSummary: mocks.useWorkspaceUsageSummary,
}));

vi.mock("@/domains/workspace/hooks/use-workspace-watches", () => ({
  useWorkspaceWatchesSnapshot: mocks.useWorkspaceWatchesSnapshot,
}));

vi.mock("@/domains/workspace/components/research-home-hero", () => ({
  ResearchHomeHero: ({ firstName }: { firstName: string | null }) => (
    <div data-testid="hero">{firstName ?? "no-name"}</div>
  ),
}));

vi.mock("@/domains/workspace/components/activity-summary-section", () => ({
  ActivitySummarySection: () => <div data-testid="activity" />,
}));

vi.mock("@/domains/workspace/components/lists-summary-section", () => ({
  ListsSummarySection: () => <div data-testid="lists" />,
}));

vi.mock("@/domains/workspace/components/follows-summary-section", () => ({
  FollowsSummarySection: () => <div data-testid="follows" />,
}));

vi.mock("@/domains/workspace/components/watchlists-summary-section", () => ({
  WatchlistsSummarySection: () => <div data-testid="watchlists" />,
}));

vi.mock("@/domains/workspace/components/research-trends-section", () => ({
  ResearchTrendsSection: ({ trends }: { trends: unknown[] }) => (
    <div data-testid="research-trends" data-trend-count={trends.length} />
  ),
}));

vi.mock("@/domains/workspace/components/recent-searches-section", () => ({
  RecentSearchesSection: ({
    runsThisMonth,
    runsPerMonthLimit,
  }: {
    runsThisMonth: number;
    runsPerMonthLimit: number | null;
  }) => (
    <div
      data-testid="recent"
      data-runs-this-month={runsThisMonth}
      data-runs-limit={runsPerMonthLimit === null ? "null" : String(runsPerMonthLimit)}
    />
  ),
}));

vi.mock("@/domains/workspace/components/next-actions-section", () => ({
  NextActionsSection: ({ workspace }: { workspace?: NextActionsWorkspaceState }) => (
    <div
      data-testid="next"
      data-brief-status={workspace?.briefs.status ?? "none"}
      data-brief-total={workspace?.briefs.data?.total ?? "none"}
      data-has-workspace={workspace ? "true" : "false"}
    />
  ),
}));

describe("ResearchHomePage", () => {
  function summary(): ResearchSummary {
    return {
      lists: [],
      activity: { newSourcesThisWeek: 0, recentItems: [], followedActorCount: 0 },
      recentRuns: [],
      researchTrends: [
        {
          id: "place:kansas city, mo:mo",
          kind: "place",
          label: "Kansas City, MO",
          latestRunAt: "2026-06-23T00:00:00.000Z",
          runCount: 2,
          signal: "2 runs over time",
        },
      ],
      totals: { savedActors: 0, listCount: 0, runsThisMonth: 1 },
      watchlists: [],
    };
  }

  function sessionWith(
    overrides: Partial<{
      isLocal: boolean;
      name: string;
      activeWorkspace: boolean;
      workspaceType: "individual" | "team";
      activeProducts: string[];
      runsPerMonth: number | null;
    }>,
  ): AtlasSessionPayload {
    const activeOrganization = overrides.activeWorkspace
      ? {
          id: "org_123",
          name: "Atlas Briefing Room Demo",
          role: "owner",
          slug: "atlas-briefing-room-demo",
          workspaceType: overrides.workspaceType ?? "team",
        }
      : null;

    return {
      isLocal: overrides.isLocal ?? false,
      accountReady: true,
      hasPasskey: false,
      passkeyCount: 0,
      session: { id: "session_1" },
      user: {
        email: "ops@atlas.test",
        emailVerified: true,
        id: "user_1",
        name: overrides.name ?? "Ada Lovelace",
      },
      workspace: {
        activeProducts: (overrides.activeProducts ??
          []) as AtlasSessionPayload["workspace"]["activeProducts"],
        activeOrganization,
        capabilities: {
          canInviteMembers: false,
          canManageOrganization: false,
          canSwitchOrganizations: false,
          canUseTeamFeatures: false,
        },
        resolvedCapabilities: {
          capabilities: [],
          limits: {
            research_runs_per_month: overrides.runsPerMonth ?? 2,
            max_shortlists: 1,
            max_shortlist_entries: 25,
            max_api_keys: 0,
            api_requests_per_day: 0,
            public_api_requests_per_hour: 100,
            max_members: 1,
          },
        },
        memberships: activeOrganization ? [activeOrganization] : [],
        onboarding: { hasPendingInvitations: false, needsWorkspace: false },
        pendingInvitations: [],
      },
    };
  }

  beforeEach(() => {
    mocks.useResearchSummary.mockReset();
    mocks.useAtlasSession.mockReset();
    mocks.useWorkspaceBriefs.mockReset();
    mocks.useWorkspaceCoverageTargets.mockReset();
    mocks.useWorkspaceUsageSummary.mockReset();
    mocks.useWorkspaceWatchesSnapshot.mockReset();
    mocks.useResearchSummary.mockReturnValue({ data: summary() });
    mocks.useWorkspaceBriefs.mockReturnValue({ data: briefCollection() });
    mocks.useWorkspaceCoverageTargets.mockReturnValue({ data: coverageTargets() });
    mocks.useWorkspaceUsageSummary.mockReturnValue({ data: usageSummary() });
    mocks.useWorkspaceWatchesSnapshot.mockReturnValue({ data: watches() });
  });

  afterEach(() => {
    cleanup();
  });

  function briefCollection(): AtlasBriefCollection {
    return {
      items: [],
      total: 2,
    };
  }

  function coverageTargets(): CoverageTargetCollection {
    return {
      items: [],
      total: 0,
    };
  }

  function usageSummary(): WorkspaceUsageSummary {
    return {
      event_counts: {
        brief_opened: 1,
      },
      org_id: "org_123",
      renewal_signals: {
        briefs_used: 1,
        coverage_gaps_closed: 0,
        integrations_used: 0,
        public_records_improved: 0,
        team_workflow_actions: 1,
      },
      total_events: 1,
    };
  }

  function watches(): WorkspaceWatchCollection {
    return {
      items: [],
      orgId: "org_123",
      total: 0,
    };
  }

  it("reads the summary query and renders every section", () => {
    mocks.useAtlasSession.mockReturnValue({ data: sessionWith({}) });

    render(<ResearchHomePage />);

    expect(mocks.useResearchSummary).toHaveBeenCalledWith();
    expect(screen.getByTestId("hero")).toHaveTextContent("Ada");
    expect(screen.getByTestId("activity")).toBeInTheDocument();
    expect(screen.getByTestId("lists")).toBeInTheDocument();
    expect(screen.getByTestId("follows")).toBeInTheDocument();
    expect(screen.getByTestId("watchlists")).toBeInTheDocument();
    expect(screen.getByTestId("research-trends")).toHaveAttribute("data-trend-count", "1");
    expect(screen.getByTestId("recent")).toBeInTheDocument();
    expect(screen.getByTestId("next")).toBeInTheDocument();
  });

  it("passes the free-tier monthly run limit through to the recent-searches strip", () => {
    mocks.useAtlasSession.mockReturnValue({ data: sessionWith({ runsPerMonth: 2 }) });

    render(<ResearchHomePage />);

    const recent = screen.getByTestId("recent");
    expect(recent).toHaveAttribute("data-runs-this-month", "1");
    expect(recent).toHaveAttribute("data-runs-limit", "2");
  });

  it("hides the run counter for paid plans", () => {
    mocks.useAtlasSession.mockReturnValue({
      data: sessionWith({ activeProducts: ["atlas_pro"], runsPerMonth: null }),
    });

    render(<ResearchHomePage />);

    expect(screen.getByTestId("recent")).toHaveAttribute("data-runs-limit", "null");
  });

  it("hides the run counter in local mode and shows a name-less greeting without a session", () => {
    mocks.useAtlasSession.mockReturnValue({ data: null });

    render(<ResearchHomePage />);

    expect(screen.getByTestId("hero")).toHaveTextContent("no-name");
    expect(screen.getByTestId("recent")).toHaveAttribute("data-runs-limit", "null");
  });

  it("derives a name-less greeting from a blank session name", () => {
    mocks.useAtlasSession.mockReturnValue({ data: sessionWith({ name: "   " }) });

    render(<ResearchHomePage />);

    expect(screen.getByTestId("hero")).toHaveTextContent("no-name");
  });

  it("renders a workspace operating picture for active team workspaces", () => {
    mocks.useAtlasSession.mockReturnValue({ data: sessionWith({ activeWorkspace: true }) });

    render(<ResearchHomePage />);

    expect(
      screen.getByRole("heading", { name: "Workspace operating picture" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Team workspace")).toBeInTheDocument();
    expect(mocks.useWorkspaceBriefs).toHaveBeenCalledWith(true, "org_123");
    expect(mocks.useWorkspaceCoverageTargets).toHaveBeenCalledWith(true, "org_123");
    expect(mocks.useWorkspaceUsageSummary).toHaveBeenCalledWith(true, "org_123");
    expect(mocks.useWorkspaceWatchesSnapshot).toHaveBeenCalledWith(true, "org_123");
    expect(screen.getByText("2 briefs")).toBeInTheDocument();
    expect(screen.getByText("1 proof event")).toBeInTheDocument();
    expect(screen.getByTestId("next")).toHaveAttribute("data-has-workspace", "true");
    expect(screen.getByTestId("next")).toHaveAttribute("data-brief-status", "ready");
    expect(screen.getByTestId("next")).toHaveAttribute("data-brief-total", "2");
  });

  it("shows unavailable operating-picture lanes when workspace counts fail", () => {
    mocks.useAtlasSession.mockReturnValue({ data: sessionWith({ activeWorkspace: true }) });
    mocks.useWorkspaceBriefs.mockReturnValue({ data: undefined, isError: true });
    mocks.useWorkspaceCoverageTargets.mockReturnValue({ data: undefined, isError: true });
    mocks.useWorkspaceUsageSummary.mockReturnValue({ data: undefined, isError: true });
    mocks.useWorkspaceWatchesSnapshot.mockReturnValue({ data: undefined, isError: true });

    render(<ResearchHomePage />);

    expect(screen.getAllByText("Unavailable")).toHaveLength(4);
    expect(screen.getByText("Briefs could not load.")).toBeInTheDocument();
    expect(screen.getByText("Coverage could not load.")).toBeInTheDocument();
    expect(screen.getByText("Monitoring could not load.")).toBeInTheDocument();
    expect(screen.getByText("Proof could not load.")).toBeInTheDocument();
    expect(screen.queryByText("Loading")).not.toBeInTheDocument();
  });

  it("labels individual active workspaces as personal workspaces", () => {
    mocks.useAtlasSession.mockReturnValue({
      data: sessionWith({ activeWorkspace: true, workspaceType: "individual" }),
    });

    render(<ResearchHomePage />);

    expect(screen.getByText("Personal workspace")).toBeInTheDocument();
    expect(screen.queryByText("Team workspace")).not.toBeInTheDocument();
  });
});
