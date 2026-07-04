// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DiscoveryRunsPanel } from "@/domains/discovery/pages/components/discovery-runs-panel";
import type { DiscoveryRunRecord } from "@/domains/discovery/discovery-run-summary";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params,
    to,
  }: {
    children: React.ReactNode;
    params?: { briefId?: string };
    to: string;
  }) => {
    const href = params?.briefId ? to.replace("$briefId", params.briefId) : to;
    return <a href={href}>{children}</a>;
  },
}));

describe("DiscoveryRunsPanel", () => {
  it("marks the run selected from a sync receipt URL", () => {
    const discoveryRun = (overrides: Partial<DiscoveryRunRecord> = {}): DiscoveryRunRecord => ({
      id: "run_123",
      completed_at: "2026-01-01T00:10:00Z",
      entries_after_dedup: 1,
      entries_confirmed: 1,
      entries_extracted: 1,
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
});
