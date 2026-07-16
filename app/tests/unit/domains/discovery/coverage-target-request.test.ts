import { describe, expect, it } from "vitest";
import {
  buildCoverageTargetCreateInputFromRun,
  canCreateCoverageTargetFromRun,
  topLeadEntryIdsFromRun,
} from "@/domains/discovery/coverage-target-request";
import type { DiscoveryRunRecord } from "@rebuildingamerica/atlas-catalog/discovery/discovery-run-summary";

describe("coverage target request conversion", () => {
  const completedRun = (): DiscoveryRunRecord => ({
    completed_at: "2026-04-20T10:05:00.000Z",
    entries_after_dedup: 8,
    entries_confirmed: 3,
    entries_extracted: 10,
    id: "run_1",
    issue_areas: ["housing_affordability"],
    location_query: "Kansas City",
    queries_generated: 2,
    research_goal: "interview_leads",
    research_summary: {
      brief: "Three source-backed tenant leads in Kansas City.",
      gaps: [{ label: "County groups", detail: "No suburban source yet." }],
      key_sources: [
        {
          publication: "City Council",
          published_date: "2026-04-19",
          source_id: "source_1",
          title: "Tenant meeting agenda",
          url: "https://example.test/agenda",
          why_it_matters: "Names the lead and issue.",
        },
      ],
      ranked_leads: [
        {
          confidence: "corroborated",
          entry_id: "entry_1",
          latest_source_date: "2026-04-19",
          name: "KC Tenants",
          source_count: 2,
          type: "organization",
          why_it_matters: "Named by city and community sources.",
        },
        {
          confidence: "partial",
          entry_id: "entry_2",
          latest_source_date: "2026-04-18",
          name: "Tenant Hotline",
          source_count: 1,
          type: "organization",
          why_it_matters: "Shows direct reachability for renter interviews.",
        },
        {
          confidence: "partial",
          entry_id: "entry_2",
          latest_source_date: "2026-04-18",
          name: "Tenant Hotline Duplicate",
          source_count: 1,
          type: "organization",
          why_it_matters: "Duplicate lead from the same entry.",
        },
      ],
      reasoning_signals: ["Two independent sources point to the same actor."],
    },
    sources_fetched: 5,
    sources_processed: 5,
    started_at: "2026-04-20T10:00:00.000Z",
    state: "MO",
    status: "completed",
  });

  it("builds a coverage target create request from a completed discovery run", () => {
    const input = buildCoverageTargetCreateInputFromRun(completedRun());

    expect(input).toEqual({
      actor_types: ["organization"],
      gaps: [
        {
          detail: "No named person leads in the ranked set.",
          label: "Named people",
        },
        {
          detail: "No suburban source yet.",
          label: "County groups",
        },
      ],
      geography: "Kansas City",
      issue_areas: ["housing_affordability"],
      linked_discovery_run_ids: ["run_1"],
      linked_entry_ids: ["entry_1", "entry_2"],
      name: "Kansas City Interview leads coverage",
      next_actions: ["Review Named people.", "Review County groups."],
      review_state: "in_review",
      source_types: ["web"],
    });
  });

  it("only allows completed runs with summary, leads, and issue areas", () => {
    const run = completedRun();
    const summary = run.research_summary;
    if (!summary) {
      throw new Error("Expected test run summary.");
    }

    expect(canCreateCoverageTargetFromRun(run)).toBe(true);
    expect(canCreateCoverageTargetFromRun({ ...run, status: "running" })).toBe(false);
    expect(canCreateCoverageTargetFromRun({ ...run, issue_areas: [] })).toBe(false);
    expect(canCreateCoverageTargetFromRun({ ...run, research_summary: null })).toBe(false);
    expect(
      canCreateCoverageTargetFromRun({
        ...run,
        research_summary: { ...summary, ranked_leads: [] },
      }),
    ).toBe(false);
  });

  it("returns the first unique ranked lead entry ids for watch handoff", () => {
    expect(topLeadEntryIdsFromRun(completedRun())).toEqual(["entry_1", "entry_2"]);
  });
});
