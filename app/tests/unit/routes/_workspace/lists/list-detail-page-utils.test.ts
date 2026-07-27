import { describe, expect, it } from "vitest";
import {
  buildResearchThreadSummary,
  downloadTextFile,
  firstNextAction,
  projectStatusForThread,
  savedListCrmFilename,
  savedListCsvFilename,
} from "@/routes/_workspace/lists/list-detail-page-utils";

describe("projectStatusForThread", () => {
  it("names the stage a research thread has reached", () => {
    expect(
      projectStatusForThread({ actorCount: 0, noteCount: 0, sourceCount: 0, followUps: [] }),
    ).toBe("Draft");
    expect(
      projectStatusForThread({ actorCount: 3, noteCount: 3, sourceCount: 0, followUps: [] }),
    ).toBe("Needs sources");
    expect(
      projectStatusForThread({ actorCount: 3, noteCount: 1, sourceCount: 5, followUps: [] }),
    ).toBe("Needs notes");
    expect(
      projectStatusForThread({ actorCount: 3, noteCount: 3, sourceCount: 5, followUps: [] }),
    ).toBe("Ready for outreach");
  });
});

describe("saved list filenames", () => {
  it("slugs the list name into the download filename", () => {
    expect(savedListCsvFilename("Kansas City Tenants", "list_1")).toBe(
      "kansas-city-tenants-list-list_1.csv",
    );
  });

  it("falls back to a readable name when the list title has no letters", () => {
    expect(savedListCrmFilename("***", "list_1")).toBe("atlas-list-crm-list_1.json");
  });
});

describe("buildResearchThreadSummary", () => {
  it("counts actors, notes and sources, and suggests what to do next", () => {
    const summary = buildResearchThreadSummary([
      { entry_id: "a", note: "Called the office.", entry: { source_count: 2 } },
      { entry_id: "b", note: "   ", entry: { source_count: 1 } },
    ]);

    expect(summary).toEqual({
      actorCount: 2,
      noteCount: 1,
      sourceCount: 3,
      followUps: ["Review latest source trail", "Add notes for unsorted leads"],
    });
  });

  it("asks for source coverage when every lead is unsourced", () => {
    const summary = buildResearchThreadSummary([
      { entry_id: "a", note: "Called the office.", entry: { source_count: 0 } },
    ]);

    expect(summary.sourceCount).toBe(0);
    expect(summary.followUps).toEqual(["Review latest source trail", "Check source coverage"]);
  });

  it("asks for nothing beyond the source trail on an empty thread", () => {
    expect(buildResearchThreadSummary([])).toEqual({
      actorCount: 0,
      noteCount: 0,
      sourceCount: 0,
      followUps: ["Review latest source trail"],
    });
  });
});

describe("firstNextAction", () => {
  it("takes the leading follow-up, or names a generic one", () => {
    expect(firstNextAction(["Add notes for unsorted leads", "Check source coverage"])).toBe(
      "Add notes for unsorted leads",
    );
    expect(firstNextAction([])).toBe("Review lead");
  });
});

describe("downloadTextFile", () => {
  it("does nothing on the server, where there is no document to download into", () => {
    // This suite runs in the node environment on purpose: the guard exists so
    // an export triggered during SSR is a no-op rather than a crash.
    expect(typeof document).toBe("undefined");
    expect(() => {
      downloadTextFile("atlas-list.csv", "name\n", "text/csv");
    }).not.toThrow();
  });
});
