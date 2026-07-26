// @vitest-environment jsdom
import type { DiscoveryRun } from "@rebuildingamerica/atlas-api-client";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { DiscoveryStatus } from "@/components/discovery/discovery-status";

describe("DiscoveryStatus", () => {
  const run: DiscoveryRun = {
    entries_after_dedup: 9,
    entries_confirmed: 7,
    entries_extracted: 12,
    id: "run_abcdef123456",
    issue_areas: ["housing"],
    location_query: "Kansas City, MO",
    queries_generated: 4,
    research_goal: "landscape_scan",
    sources_fetched: 20,
    sources_processed: 18,
    started_at: "2026-05-01T00:00:00.000Z",
    state: "MO",
    status: "completed",
  };

  afterEach(() => {
    cleanup();
  });

  it("renders the run summary with a hydration-stable start time", () => {
    render(<DiscoveryStatus run={run} />);

    expect(screen.getByText("Request run_abcd")).toBeInTheDocument();
    expect(screen.getByText("5/1/2026, 12:00:00 AM")).toBeInTheDocument();
    expect(screen.getByText("Kansas City, MO")).toBeInTheDocument();
    expect(screen.getByText("completed")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
  });
});
