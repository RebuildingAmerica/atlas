// @vitest-environment jsdom
import "./discovery-page-test-setup";

import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DiscoveryPage } from "@/domains/discovery/pages/discovery-page";
import { mocks } from "./discovery-page-test-setup";

describe("DiscoveryPage leads and blind spots", () => {
  it("watches the top ranked leads from a completed research summary", async () => {
    const watchWorkspaceResource = vi.fn().mockResolvedValue(undefined);
    mocks.useWatchWorkspaceResource.mockReturnValue({
      mutateAsync: watchWorkspaceResource,
      isPending: false,
    });
    mocks.useDiscoveryRuns.mockReturnValue({
      data: {
        items: [
          {
            id: "run_1",
            location_query: "Kansas City",
            research_goal: "interview_leads",
            started_at: "2026-04-20T10:00:00.000Z",
            completed_at: "2026-04-20T10:05:00.000Z",
            state: "MO",
            status: "completed",
            issue_areas: ["housing_affordability"],
            queries_generated: 2,
            sources_fetched: 5,
            sources_processed: 5,
            entries_extracted: 10,
            entries_after_dedup: 8,
            entries_confirmed: 3,
            error_message: null,
            research_summary: {
              brief: "Three source-backed tenant leads in Kansas City.",
              ranked_leads: [
                {
                  entry_id: "entry_1",
                  name: "KC Tenants",
                  type: "organization",
                  why_it_matters: "Named by city and community sources.",
                  source_count: 2,
                  confidence: "corroborated",
                  latest_source_date: "2026-04-19",
                },
                {
                  entry_id: "entry_2",
                  name: "Tenant Hotline",
                  type: "organization",
                  why_it_matters: "Shows direct reachability for renter interviews.",
                  source_count: 1,
                  confidence: "partial",
                  latest_source_date: "2026-04-18",
                },
              ],
              key_sources: [
                {
                  source_id: "source_1",
                  title: "Tenant meeting agenda",
                  url: "https://example.test/agenda",
                  publication: "City Council",
                  published_date: "2026-04-19",
                  why_it_matters: "Names the lead and issue.",
                },
              ],
              gaps: [],
              reasoning_signals: ["Two independent sources point to the same actor."],
            },
          },
        ],
      },
      isLoading: false,
    });

    render(<DiscoveryPage />);

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Watch top leads" }));
    });

    await waitFor(() => {
      expect(watchWorkspaceResource).toHaveBeenCalledTimes(2);
    });
    expect(watchWorkspaceResource).toHaveBeenNthCalledWith(1, {
      notificationPreference: "digest",
      resourceId: "entry_1",
      resourceType: "entry",
    });
    expect(watchWorkspaceResource).toHaveBeenNthCalledWith(2, {
      notificationPreference: "digest",
      resourceId: "entry_2",
      resourceType: "entry",
    });
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Open watching" })).toHaveAttribute(
        "href",
        "/watching",
      );
    });
  });

  it("renders ranked leads without a nested recommended lead set card", () => {
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
                {
                  entry_id: "entry-2",
                  name: "Tenant Hotline",
                  type: "organization",
                  why_it_matters: "Shows direct reachability for renter interviews.",
                  source_count: 1,
                  latest_source_date: "2026-04-18",
                },
              ],
              key_sources: [],
              gaps: [],
              reasoning_signals: [],
            },
          },
        ],
      },
      isLoading: false,
    });

    render(<DiscoveryPage />);

    expect(screen.queryByText("Recommended lead set")).not.toBeInTheDocument();
    expect(screen.queryByText("Interview source set")).not.toBeInTheDocument();
    expect(screen.queryByText("First calls from the ranked leads.")).not.toBeInTheDocument();
    expect(screen.getAllByText("KC Tenants")).toHaveLength(1);
    expect(screen.getAllByText("Tenant Hotline")).toHaveLength(1);
    expect(screen.getByText("2 sources")).toBeInTheDocument();
    expect(screen.getAllByText("Partial")).toHaveLength(1);
  });

  it("surfaces likely missing actor categories from completed research runs", () => {
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
            entries_extracted: 6,
            sources_fetched: 4,
            entries_after_dedup: 3,
            error_message: null,
            research_summary: {
              brief: "Organization-heavy tenant leads in Kansas City.",
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
              key_sources: [],
              gaps: [{ label: "County groups", detail: "No suburban source yet." }],
              reasoning_signals: [],
            },
          },
        ],
      },
      isLoading: false,
    });

    render(<DiscoveryPage />);

    expect(screen.getByText("Blind spots")).toBeInTheDocument();
    expect(screen.getByText("Named people")).toBeInTheDocument();
    expect(screen.getByText("No named person leads in the ranked set.")).toBeInTheDocument();
    expect(screen.getByText("County groups")).toBeInTheDocument();
    expect(screen.getByText("No suburban source yet.")).toBeInTheDocument();
  });
});
