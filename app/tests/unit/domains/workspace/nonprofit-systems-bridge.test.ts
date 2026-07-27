import { describe, expect, it } from "vitest";
import {
  buildNonprofitSystemsPacket,
  type NonprofitSystemsBridgeItem,
} from "@/domains/workspace/nonprofit-systems-bridge";

describe("nonprofit systems packet", () => {
  function locationForItem(item: NonprofitSystemsBridgeItem): string {
    return [item.entry?.address?.city, item.entry?.address?.state].filter(Boolean).join(", ");
  }

  it("says the list is empty rather than handing over a bare header", () => {
    const packet = buildNonprofitSystemsPacket({
      actorCount: 0,
      description: null,
      items: [],
      listName: "Coalition outreach",
      locationForItem,
      nextAction: "Add to the CRM",
      noteCount: 0,
      sourceCount: 0,
      workspaceName: "Rebuilding Kansas City",
    });

    expect(packet).toBe(
      [
        "Coalition outreach nonprofit systems packet",
        "Workspace: Rebuilding Kansas City",
        "",
        "Actors: 0",
        "Sources: 0",
        "Notes: 0",
        "Ready for: Advocacy CRM, grant diligence, coalition ops",
        "",
        "No saved actors yet.",
      ].join("\n"),
    );
  });

  it("carries actor type, place, source count, and note into the export", () => {
    const packet = buildNonprofitSystemsPacket({
      actorCount: 2,
      description: "Grant diligence",
      items: [
        {
          entry: {
            address: { city: "Kansas City", state: "MO" },
            name: "KC Tenants",
            source_count: 1,
            type: "organization",
          },
          entry_id: "entry_1",
          note: "Confirm the fiscal sponsor.",
        },
        {
          entry: { address: null, name: null, source_count: null, type: null },
          entry_id: "entry_2",
          note: null,
        },
      ],
      listName: "Coalition outreach",
      locationForItem,
      nextAction: "Add to the CRM",
      noteCount: 1,
      sourceCount: 4,
      workspaceName: "Rebuilding Kansas City",
    });

    expect(packet).toBe(
      [
        "Coalition outreach nonprofit systems packet",
        "Workspace: Rebuilding Kansas City",
        "Description: Grant diligence",
        "",
        "Actors: 2",
        "Sources: 4",
        "Notes: 1",
        "Ready for: Advocacy CRM, grant diligence, coalition ops",
        "",
        "KC Tenants — organization — Kansas City, MO — 1 source",
        "Note: Confirm the fiscal sponsor.",
        "Next action: Add to the CRM",
        "Profile unavailable —  —  — 0 sources",
        "Next action: Add to the CRM",
      ].join("\n"),
    );
  });
});
