// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResearchHomePage } from "@/domains/workspace/pages/research-home-page";
import type { ResearchSummary } from "@/domains/workspace/server/research-summary";
import type { AtlasSessionPayload } from "@/domains/access/organization-contracts";

const mocks = vi.hoisted(() => ({
  useResearchSummary: vi.fn(),
  useAtlasSession: vi.fn(),
}));

vi.mock("@/domains/workspace/hooks/use-research-summary", () => ({
  useResearchSummary: mocks.useResearchSummary,
}));

vi.mock("@/domains/access", () => ({
  useAtlasSession: mocks.useAtlasSession,
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
  NextActionsSection: () => <div data-testid="next" />,
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
      activeProducts: string[];
      runsPerMonth: number | null;
    }>,
  ): AtlasSessionPayload {
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
        activeOrganization: null,
        activeProducts: (overrides.activeProducts ??
          []) as AtlasSessionPayload["workspace"]["activeProducts"],
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
        memberships: [],
        onboarding: { hasPendingInvitations: false, needsWorkspace: false },
        pendingInvitations: [],
      },
    };
  }

  beforeEach(() => {
    mocks.useResearchSummary.mockReset();
    mocks.useAtlasSession.mockReset();
    mocks.useResearchSummary.mockReturnValue({ data: summary() });
  });

  afterEach(() => {
    cleanup();
  });

  it("seeds the summary query from the loader payload and renders every section", () => {
    mocks.useAtlasSession.mockReturnValue({ data: sessionWith({}) });

    render(<ResearchHomePage initialSummary={summary()} />);

    const seed = summary();
    expect(mocks.useResearchSummary).toHaveBeenCalledWith(seed);
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

    render(<ResearchHomePage initialSummary={summary()} />);

    const recent = screen.getByTestId("recent");
    expect(recent).toHaveAttribute("data-runs-this-month", "1");
    expect(recent).toHaveAttribute("data-runs-limit", "2");
  });

  it("hides the run counter for paid plans", () => {
    mocks.useAtlasSession.mockReturnValue({
      data: sessionWith({ activeProducts: ["atlas_pro"], runsPerMonth: null }),
    });

    render(<ResearchHomePage initialSummary={summary()} />);

    expect(screen.getByTestId("recent")).toHaveAttribute("data-runs-limit", "null");
  });

  it("hides the run counter in local mode and shows a name-less greeting without a session", () => {
    mocks.useAtlasSession.mockReturnValue({ data: null });

    render(<ResearchHomePage initialSummary={summary()} />);

    expect(screen.getByTestId("hero")).toHaveTextContent("no-name");
    expect(screen.getByTestId("recent")).toHaveAttribute("data-runs-limit", "null");
  });

  it("derives a name-less greeting from a blank session name", () => {
    mocks.useAtlasSession.mockReturnValue({ data: sessionWith({ name: "   " }) });

    render(<ResearchHomePage initialSummary={summary()} />);

    expect(screen.getByTestId("hero")).toHaveTextContent("no-name");
  });
});
