// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DiscoveryRunsPanel } from "@rebuildingamerica/atlas-catalog/discovery/components";
import type { DiscoveryRunRecord } from "@rebuildingamerica/atlas-catalog/discovery/discovery-run-summary";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

describe("DiscoveryRunsPanel", () => {
  const discoveryRun = (overrides: Partial<DiscoveryRunRecord> = {}): DiscoveryRunRecord => ({
    completed_at: "2026-01-01T00:10:00Z",
    entries_after_dedup: 1,
    entries_confirmed: 1,
    entries_extracted: 1,
    id: "run_123",
    issue_areas: ["housing_affordability"],
    location_query: "Kansas City, MO",
    queries_generated: 1,
    research_goal: "landscape_scan",
    research_summary: null,
    sources_fetched: 1,
    sources_processed: 1,
    started_at: "2026-01-01T00:00:00Z",
    state: "MO",
    status: "completed",
    ...overrides,
  });

  it("marks the run selected from a sync receipt URL", () => {
    render(
      <DiscoveryRunsPanel
        isLoading={false}
        runs={[discoveryRun(), discoveryRun({ id: "run_456", location_query: "Austin, TX" })]}
        selectedRunId="run_123"
      />,
    );

    expect(screen.getByText("Selected run")).toBeInTheDocument();
    expect(screen.getByText("Kansas City, MO")).toBeInTheDocument();
  });

  it("renders coverage and watch handoff actions for a completed run", () => {
    const onCreateCoverageTarget = vi.fn();
    const onWatchTopLeads = vi.fn();

    render(
      <DiscoveryRunsPanel
        createdCoverageTargets={{
          run_123: { id: "coverage_123", name: "Kansas City coverage" },
        }}
        isLoading={false}
        onCreateCoverageTarget={onCreateCoverageTarget}
        onWatchTopLeads={onWatchTopLeads}
        runs={[
          discoveryRun({
            research_summary: {
              brief: "Source-backed local research.",
              gaps: [],
              key_sources: [
                {
                  source_id: "source_1",
                  title: "Tenant meeting agenda",
                  url: "https://example.test/agenda",
                  why_it_matters: "Names the lead and issue.",
                },
              ],
              ranked_leads: [
                {
                  entry_id: "entry_1",
                  name: "KC Tenants",
                  source_count: 2,
                  type: "organization",
                  why_it_matters: "Named by city and community sources.",
                },
              ],
              reasoning_signals: [],
            },
          }),
        ]}
        watchedLeadCounts={{ run_123: 1 }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Create coverage target" }));
    fireEvent.click(screen.getByRole("button", { name: "Watch top leads" }));

    expect(onCreateCoverageTarget).toHaveBeenCalledWith(expect.objectContaining({ id: "run_123" }));
    expect(onWatchTopLeads).toHaveBeenCalledWith(expect.objectContaining({ id: "run_123" }));
    const coverageLink = screen.getByRole("link", { name: "Open coverage" });
    expect(coverageLink).toHaveAttribute("data-link-to", "/coverage/$targetId");
    expect(coverageLink).toHaveAttribute(
      "data-link-params",
      JSON.stringify({ targetId: "coverage_123" }),
    );
    expect(screen.getByText("Watching 1 lead.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open watching" })).toHaveAttribute(
      "href",
      "/watching",
    );
  });
});
