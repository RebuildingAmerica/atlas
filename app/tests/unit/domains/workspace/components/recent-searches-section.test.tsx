// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { ReactNode } from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RecentSearchesSection } from "@/domains/workspace/components/recent-searches-section";
import type { RecentRunSummary } from "@/domains/workspace/server/research-summary";
import type { ResearchValueGate } from "@/domains/workspace/components/research-value-nudge";
import type { SerializedResolvedCapabilities } from "@rebuildingamerica/atlas-access/workspace/capabilities";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: ReactNode; to?: string }) => (
    <a href={to} data-link-to={to}>
      {children}
    </a>
  ),
}));

vi.mock("@/domains/workspace/components/research-value-nudge", () => ({
  ResearchValueNudge: ({ gate }: { gate: ResearchValueGate }) => (
    <div data-testid="value-nudge" data-gate={JSON.stringify(gate)} />
  ),
}));

describe("RecentSearchesSection", () => {
  afterEach(() => {
    cleanup();
  });

  function runs(): RecentRunSummary[] {
    return [
      {
        id: "r1",
        locationQuery: "Kansas City, MO",
        state: "MO",
        status: "completed",
        startedAt: "2026-06-20T00:00:00.000Z",
        issueAreas: ["housing_affordability"],
      },
    ];
  }

  const freeCapabilities: SerializedResolvedCapabilities = {
    capabilities: [],
    limits: {
      research_runs_per_month: 2,
      max_shortlists: 1,
      max_shortlist_entries: 25,
      max_api_keys: 0,
      api_requests_per_day: 0,
      public_api_requests_per_hour: 100,
      max_members: 1,
    },
  };

  interface RenderOverrides {
    runs: RecentRunSummary[];
    runsThisMonth: number;
    runsPerMonthLimit: number | null;
    isLocal: boolean;
    isFreeTier: boolean;
    savedActors: number;
    listCount: number;
  }

  function renderSection(overrides: Partial<RenderOverrides>) {
    return render(
      <RecentSearchesSection
        runs={overrides.runs ?? runs()}
        runsThisMonth={overrides.runsThisMonth ?? 1}
        runsPerMonthLimit={
          "runsPerMonthLimit" in overrides ? (overrides.runsPerMonthLimit ?? null) : 2
        }
        capabilities={freeCapabilities}
        isLocal={overrides.isLocal ?? false}
        isFreeTier={overrides.isFreeTier ?? true}
        savedActors={overrides.savedActors ?? 0}
        listCount={overrides.listCount ?? 1}
      />,
    );
  }

  it("renders recent research cards linking to discovery and the honest free-request counter", () => {
    renderSection({ runsThisMonth: 1, runsPerMonthLimit: 2 });

    const card = screen.getByRole("link", { name: /Kansas City, MO/ });
    expect(card).toHaveAttribute("data-link-to", "/discovery");
    expect(screen.getByText(/MO · completed/)).toBeInTheDocument();
    expect(screen.getByText(/1 of 2 free research requests used this month\./)).toBeInTheDocument();
  });

  it("uses the singular request noun when the monthly allowance is one", () => {
    renderSection({ runsThisMonth: 0, runsPerMonthLimit: 1 });

    expect(screen.getByText(/0 of 1 free research request used this month\./)).toBeInTheDocument();
  });

  it("hides the counter when no finite limit applies", () => {
    renderSection({ runsThisMonth: 5, runsPerMonthLimit: null });

    expect(screen.queryByText(/free research request/)).not.toBeInTheDocument();
  });

  it("shows the empty state when no research has started", () => {
    renderSection({ runs: [], runsThisMonth: 0, runsPerMonthLimit: null });

    expect(screen.getByText("No research yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start research" })).toHaveAttribute(
      "data-link-to",
      "/discovery",
    );
  });

  it("passes an unlimited gate carrying the totals to the value nudge", () => {
    renderSection({ runsThisMonth: 2, isFreeTier: true, savedActors: 18, listCount: 1 });

    expect(screen.getByTestId("value-nudge")).toHaveAttribute(
      "data-gate",
      JSON.stringify({
        kind: "unlimited",
        isFreeTier: true,
        savedActors: 18,
        listCount: 1,
        runsThisMonth: 2,
      }),
    );
  });
});
