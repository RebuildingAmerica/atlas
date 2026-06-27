import { describe, expect, it } from "vitest";
import {
  buildAgentResearchArtifact,
  buildLeadCsvExport,
  buildMarkdownBriefExport,
} from "@/domains/discovery/research-artifacts";
import { createCompletedResearchRunFixture } from "../../../fixtures/discovery/research-runs";

describe("research artifact exports", () => {
  it("builds a stable agent JSON artifact for completed research runs", () => {
    const artifact = buildAgentResearchArtifact(createCompletedResearchRunFixture());

    expect(artifact).toEqual({
      schema_version: "atlas.research_artifact.v1",
      run: {
        id: "run_1",
        location_query: "Kansas City",
        state: "MO",
        research_goal: "interview_leads",
        issue_areas: ["housing_affordability"],
        status: "completed",
        started_at: "2026-04-20T10:00:00.000Z",
        completed_at: "2026-04-20T10:05:00.000Z",
      },
      outputs: {
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
      workflow: {
        primary_use: "Interview source list",
        export_formats: ["json", "markdown", "csv"],
        next_actions: [
          "Review source links before outreach",
          "Contact the highest-confidence leads first",
          "Use gaps to guide a follow-up search",
        ],
      },
    });
  });

  it("builds markdown and CSV exports that preserve source-linked context", () => {
    const run = createCompletedResearchRunFixture();

    expect(buildMarkdownBriefExport(run)).toContain("# Kansas City research brief");
    expect(buildMarkdownBriefExport(run)).toContain(
      "- [Tenant meeting agenda](https://example.test/agenda) — Names the lead and issue.",
    );
    expect(buildLeadCsvExport(run)).toBe(
      [
        "rank,name,type,confidence,source_count,latest_source_date,why_it_matters",
        '"1","KC Tenants","organization","corroborated","2","2026-04-19","Named by city and community sources."',
      ].join("\n"),
    );
  });
});
