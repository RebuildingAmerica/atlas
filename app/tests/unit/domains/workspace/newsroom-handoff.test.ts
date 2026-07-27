import { describe, expect, it } from "vitest";
import {
  buildNewsroomAssignmentPacket,
  type NewsroomHandoffItem,
} from "@/domains/workspace/newsroom-handoff";

describe("newsroom assignment packet", () => {
  function locationForItem(item: NewsroomHandoffItem): string {
    return [item.entry?.address?.city, item.entry?.address?.state].filter(Boolean).join(", ");
  }

  it("says the list is empty rather than handing over a bare header", () => {
    const packet = buildNewsroomAssignmentPacket({
      actorCount: 0,
      description: null,
      items: [],
      listName: "Kansas City tenants",
      locationForItem,
      nextAction: "Call the hotline",
      noteCount: 0,
      sourceCount: 0,
    });

    expect(packet).toBe(
      [
        "Kansas City tenants assignment packet",
        "",
        "Leads: 0",
        "Sources: 0",
        "Notes: 0",
        "Next action: Call the hotline",
        "",
        "No saved actors yet.",
      ].join("\n"),
    );
  });

  it("names each lead with its place, source count, and reporter note", () => {
    const packet = buildNewsroomAssignmentPacket({
      actorCount: 2,
      description: "Eviction defense desk",
      items: [
        {
          entry: {
            address: { city: "Kansas City", state: "MO" },
            name: "KC Tenants",
            source_count: 1,
          },
          entry_id: "entry_1",
          note: "Ask about the court watch roster.",
        },
        {
          entry: { address: null, name: null, source_count: null },
          entry_id: "entry_2",
          note: null,
        },
      ],
      listName: "Kansas City tenants",
      locationForItem,
      nextAction: "Call the hotline",
      noteCount: 1,
      sourceCount: 3,
    });

    expect(packet).toBe(
      [
        "Kansas City tenants assignment packet",
        "Eviction defense desk",
        "",
        "Leads: 2",
        "Sources: 3",
        "Notes: 1",
        "Next action: Call the hotline",
        "",
        "KC Tenants — Kansas City, MO — 1 source",
        "Note: Ask about the court watch roster.",
        "Profile unavailable —  — 0 sources",
      ].join("\n"),
    );
  });
});
