// @vitest-environment jsdom
import "./discovery-page-test-setup";

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DiscoveryPage } from "@/domains/discovery/pages/discovery-page";
import { FREE_TIER_SESSION, mocks } from "./discovery-page-test-setup";

describe("DiscoveryPage runs and status", () => {
  it("renders a recent run without an error message when none is set", () => {
    mocks.useDiscoveryRuns.mockReturnValue({
      data: {
        items: [
          {
            id: "run_1",
            location_query: "Chicago",
            research_goal: "landscape_scan",
            started_at: "2026-04-20T10:00:00.000Z",
            state: "IL",
            status: "completed",
            issue_areas: ["area1"],
            entries_extracted: 10,
            sources_fetched: 5,
            entries_after_dedup: 8,
            error_message: null,
          },
        ],
      },
      isLoading: false,
    });
    render(<DiscoveryPage />);
    expect(screen.getByText("Chicago")).toBeInTheDocument();
    expect(screen.queryByText(/Process failed/)).toBeNull();
  });

  it("renders the in-flight start-run label when the start mutation is pending", () => {
    mocks.useStartDiscovery.mockReturnValue({
      mutate: vi.fn(),
      isPending: true,
      error: null,
    });
    render(<DiscoveryPage />);
    expect(screen.getByText(/Starting\.\.\./)).toBeInTheDocument();
  });

  it("renders recent runs and handles error messages", () => {
    mocks.useDiscoveryRuns.mockReturnValue({
      data: {
        items: [
          {
            id: "run_1",
            location_query: "Chicago",
            research_goal: "landscape_scan",
            started_at: "2026-04-20T10:00:00.000Z",
            state: "IL",
            status: "completed",
            issue_areas: ["area1"],
            entries_extracted: 10,
            sources_fetched: 5,
            entries_after_dedup: 8,
            error_message: "Process failed",
          },
        ],
      },
      isLoading: false,
    });

    render(<DiscoveryPage />);
    expect(screen.getByText("Chicago")).toBeInTheDocument();
    expect(screen.getByText("Process failed")).toBeInTheDocument();
  });

  it("renders structured research output for completed runs", () => {
    mocks.useDiscoveryRuns.mockReturnValue({
      data: {
        items: [
          {
            id: "run_1",
            location_query: "Kansas City",
            research_goal: "interview_leads",
            started_at: "2026-04-20T10:00:00.000Z",
            state: "MO",
            status: "completed",
            issue_areas: ["housing_affordability"],
            entries_extracted: 10,
            sources_fetched: 5,
            entries_after_dedup: 8,
            error_message: null,
            research_summary: {
              brief: "Three source-backed tenant leads in Kansas City.",
              ranked_leads: [
                {
                  entry_id: "entry-1",
                  name: "KC Tenants",
                  type: "organization",
                  why_it_matters: "Named by city and community sources.",
                  source_count: 2,
                  confidence: "corroborated",
                  latest_source_date: "2026-04-19",
                },
              ],
              key_sources: [
                {
                  source_id: "source-1",
                  title: "Tenant meeting agenda",
                  url: "https://example.test/agenda",
                  publication: "City Council",
                  published_date: "2026-04-19",
                  why_it_matters: "Names the lead and issue.",
                },
              ],
              gaps: [{ label: "County groups", detail: "No suburban source yet." }],
              reasoning_signals: ["Two independent sources point to the same actor."],
            },
          },
        ],
      },
      isLoading: false,
    });

    render(<DiscoveryPage />);

    expect(
      screen.getByText("Three source-backed tenant leads in Kansas City."),
    ).toBeInTheDocument();
    expect(screen.getAllByText("KC Tenants")).toHaveLength(1);
    expect(screen.getAllByText("Corroborated")).toHaveLength(1);
    expect(screen.getByText("Named by city and community sources.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Sync readiness" })).not.toBeInTheDocument();
    expect(screen.queryByText("Ready for CRM or newsroom handoff")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Tenant meeting agenda" })).toHaveAttribute(
      "href",
      "https://example.test/agenda",
    );
    expect(screen.getByText("County groups")).toBeInTheDocument();
    expect(screen.getByText("No suburban source yet.")).toBeInTheDocument();
  });

  it("shows loading state for runs", () => {
    mocks.useDiscoveryRuns.mockReturnValue({ data: null, isLoading: true });
    mocks.useTaxonomy.mockReturnValue({ data: null, isLoading: true });

    render(<DiscoveryPage />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("shows unavailable message when taxonomy is empty", () => {
    mocks.useTaxonomy.mockReturnValue({ data: {}, isLoading: false });

    render(<DiscoveryPage />);
    expect(screen.getByText(/Could not load issue areas/i)).toBeInTheDocument();
  });

  it("shows start error message when mutation fails", () => {
    mocks.useStartDiscovery.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      error: new Error("Fail"),
    });

    render(<DiscoveryPage />);
    expect(screen.getByRole("alert")).toHaveTextContent(/Could not start research/i);
  });

  it("keeps team workspace context out of a separate hero", () => {
    mocks.useAtlasSession.mockReturnValue({
      data: {
        workspace: {
          activeOrganization: {
            id: "org_1",
            name: "Atlas Team",
            role: "owner",
            workspaceType: "team",
          },
          capabilities: { canUseTeamFeatures: true },
          resolvedCapabilities: {
            capabilities: ["research.run"],
            limits: {
              research_runs_per_month: 2,
              max_shortlists: 1,
              max_shortlist_entries: 25,
              max_api_keys: 0,
              api_requests_per_day: 0,
              public_api_requests_per_hour: 100,
              max_members: 1,
            },
          },
          onboarding: { needsWorkspace: false, hasPendingInvitations: false },
        },
      },
    });

    render(<DiscoveryPage />);
    expect(screen.queryByText("Team discovery")).not.toBeInTheDocument();
    expect(screen.queryByText("Atlas Team discovery")).not.toBeInTheDocument();
    expect(screen.getByText("Recent research")).toBeInTheDocument();
  });

  it("surfaces an in-the-moment upgrade prompt when a run is blocked at the limit", async () => {
    const { AtlasApiError, ATLAS_API_ERROR_CODE } = await import("@/domains/discovery/api-errors");
    mocks.useStartDiscovery.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      error: new AtlasApiError(ATLAS_API_ERROR_CODE.AT_LIMIT),
    });
    mocks.useAtlasSession.mockReturnValue(FREE_TIER_SESSION);

    render(<DiscoveryPage />);

    expect(screen.getByText(/You've used your free research this month/)).toBeInTheDocument();
    expect(screen.queryByText(/Could not start research/)).toBeNull();
    const upgrade = screen.getByText("Upgrade").closest("a");
    expect(upgrade).toHaveAttribute("href", "/pricing?intent=atlas_pro");
  });

  it("shows safe retry copy when Atlas is temporarily unavailable", async () => {
    const { AtlasApiError, ATLAS_API_ERROR_CODE } = await import("@/domains/discovery/api-errors");
    mocks.useStartDiscovery.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      error: new AtlasApiError(ATLAS_API_ERROR_CODE.TEMPORARILY_UNAVAILABLE),
    });
    mocks.useAtlasSession.mockReturnValue(FREE_TIER_SESSION);

    render(<DiscoveryPage />);

    expect(screen.getByText(/Atlas is temporarily unavailable/)).toBeInTheDocument();
    expect(screen.queryByText(/You've used your free research this month/)).toBeNull();
  });
});
