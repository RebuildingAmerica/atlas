import { describe, expect, it } from "vitest";
import {
  buildBriefCreateInputFromRun,
  canCreateBriefFromRun,
} from "@/domains/discovery/brief-request";
import type { DiscoveryRunRecord } from "@rebuildingamerica/atlas-catalog/discovery/discovery-run-summary";

describe("brief request conversion", () => {
  const completedRun = (): DiscoveryRunRecord => ({
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
        {
          source_id: "source_2",
          title: "Court watch notes",
          url: "https://example.test/court-watch",
          publication: "Community News",
          published_date: "2026-04-18",
          why_it_matters: "Confirms the lead's campaign role.",
        },
      ],
      gaps: [{ label: "County groups", detail: "No suburban source yet." }],
      reasoning_signals: ["Two independent sources point to the same actor."],
    },
  });

  it("builds a source-linked brief create request from a completed discovery run", () => {
    const input = buildBriefCreateInputFromRun(completedRun());

    expect(input).toEqual({
      title: "Kansas City Interview leads",
      scope: {
        actor_types: ["organization"],
        geography: "Kansas City",
        issue_areas: ["housing_affordability"],
        source_types: ["web"],
      },
      summary: "Three source-backed tenant leads in Kansas City.",
      linked_entry_ids: ["entry_1"],
      linked_source_ids: ["source_1", "source_2"],
      linked_discovery_run_ids: ["run_1"],
      confidence_summary: {
        review_status: "needs review",
        source_count: 2,
        state: "corroborated",
      },
      gaps: [
        {
          label: "Named people",
          detail: "No named person leads in the ranked set.",
        },
        {
          label: "County groups",
          detail: "No suburban source yet.",
        },
      ],
    });
  });

  it("only allows completed runs with leads, sources, and a summary", () => {
    const run = completedRun();
    const summary = run.research_summary;
    if (!summary) {
      throw new Error("Expected test run summary.");
    }

    expect(canCreateBriefFromRun(run)).toBe(true);

    expect(canCreateBriefFromRun({ ...run, status: "running" })).toBe(false);
    expect(canCreateBriefFromRun({ ...run, research_summary: null })).toBe(false);
    expect(
      canCreateBriefFromRun({
        ...run,
        research_summary: { ...summary, ranked_leads: [] },
      }),
    ).toBe(false);
    expect(
      canCreateBriefFromRun({
        ...run,
        research_summary: { ...summary, key_sources: [] },
      }),
    ).toBe(false);
  });
});
