import { describe, expect, it } from "vitest";
import { formatStableDateTime } from "@rebuildingamerica/atlas-ui/format/date-time";
import {
  briefExportCsvFilename,
  briefExportFilename,
  briefExportToCsv,
  confidenceVariant,
  downloadCsvFile,
  downloadJsonFile,
  formatDate,
  parseGapsText,
  sourceLabel,
} from "@/domains/workspace/pages/brief-detail-page-utils";
import type { AtlasBriefExport } from "@/domains/workspace/server/briefs";

describe("brief export utilities", () => {
  function briefExport(): AtlasBriefExport {
    return {
      brief: {
        confidence_summary: {
          review_status: "reviewed by research",
          source_count: 1,
          state: "unverified",
        },
        created_at: "2026-07-03T10:00:00.000Z",
        created_by: "operator_1",
        gaps: [],
        id: "brief_123",
        linked_discovery_run_ids: [],
        linked_entry_ids: [],
        linked_source_ids: [],
        org_id: "org_123",
        scope: {
          actor_types: ["organization"],
          geography: "Kansas City, MO",
          issue_areas: ["housing"],
          source_types: ["news"],
        },
        summary: "Summary, with a comma.",
        title: "Tenant Power",
        updated_at: "2026-07-03T11:00:00.000Z",
      },
      discovery_runs: [],
      entries: [
        {
          city: null,
          id: "entry_1",
          name: "KC Tenants",
          state: null,
          type: "organization",
        },
      ],
      format: "json",
      provenance: {
        confidence_state: "unverified",
        discovery_run_count: 0,
        entry_count: 1,
        review_status: "reviewed by research",
        source_count: 1,
      },
      sources: [
        {
          id: "source_1",
          ingested_at: "2026-07-01T12:00:00.000Z",
          publication: null,
          published_date: null,
          title: null,
          type: "news",
          url: "https://example.org/tenant-organizing",
        },
      ],
    };
  }

  it("falls back to the source address when a receipt carries no headline", () => {
    expect(
      sourceLabel({
        id: "source_1",
        ingested_at: "2026-07-01T12:00:00.000Z",
        title: "   ",
        type: "news",
        url: "https://example.org/tenant-organizing",
      }),
    ).toBe("https://example.org/tenant-organizing");
  });

  it("returns no date at all rather than an empty-looking one", () => {
    expect(formatDate(formatStableDateTime, null)).toBeNull();
    expect(formatDate(formatStableDateTime, undefined)).toBeNull();
    expect(formatDate(formatStableDateTime, "2026-06-28")).toBe("Jun 28, 2026");
  });

  it("grades every confidence state the brief can carry", () => {
    expect(confidenceVariant("corroborated")).toBe("success");
    expect(confidenceVariant("partial")).toBe("warning");
    expect(confidenceVariant("unverified")).toBe("default");
  });

  it("names a download even when the title has no usable characters", () => {
    const brief = briefExport().brief;
    expect(briefExportFilename(brief)).toBe("tenant-power-brief_123.json");
    expect(briefExportCsvFilename({ ...brief, title: "***" })).toBe("atlas-brief-brief_123.csv");
  });

  it("writes empty cells for the facts a record does not carry", () => {
    const csv = briefExportToCsv(briefExport());
    const rows = csv.trimEnd().split("\n");

    expect(rows[0]).toContain("row_type,record_id,title");
    expect(rows[1]).toContain('"Summary, with a comma."');
    expect(rows[2]).toBe("entry,entry_1,,KC Tenants,organization,,,,,,,,,,,,,,,");
    expect(rows[3]).toBe(
      "source,source_1,,,news,,https://example.org/tenant-organizing,,,,,,,,,,,,,2026-07-01T12:00:00.000Z",
    );
  });

  it("refuses a gap line that names no detail", () => {
    expect(parseGapsText("Rural organizers: Confirm coverage.\n\n")).toEqual([
      { detail: "Confirm coverage.", label: "Rural organizers" },
    ]);
    expect(() => parseGapsText("Rural organizers")).toThrow("Each gap needs a label and detail.");
    expect(() => parseGapsText(": no label")).toThrow("Each gap needs a label and detail.");
    expect(() => parseGapsText("no detail:")).toThrow("Each gap needs a label and detail.");
  });

  it("does nothing when there is no document to hang a download off", () => {
    expect(() => {
      downloadJsonFile("brief.json", "{}");
      downloadCsvFile("brief.csv", "row_type\n");
    }).not.toThrow();
  });
});
