import { describe, expect, it, vi } from "vitest";
import { parseConnectionsData } from "./connections-data";
import {
  FULL_ENTITY_PAYLOAD,
  MINIMAL_ENTITY_PAYLOAD,
} from "./test-support/entity-fixtures";

const CONNECTIONS_PAYLOAD = {
  entity_id: "e0",
  items: [
    {
      entity: FULL_ENTITY_PAYLOAD,
      relationships: [
        { type: "shared_place" },
        { type: "shared_issue_area", issue_area_ids: ["housing"] },
      ],
    },
    {
      entity: MINIMAL_ENTITY_PAYLOAD,
      relationships: [{ type: "affiliated_organization" }],
    },
  ],
  total: 8,
  next_cursor: "2",
};

describe("parseConnectionsData", () => {
  it("narrows a full EntityRelationshipsResponse-shaped payload down to ConnectionsData", () => {
    expect(parseConnectionsData(CONNECTIONS_PAYLOAD)).toEqual({
      entity_id: "e0",
      items: [
        {
          entity: {
            id: "e1",
            name: "Jane Doe",
            type: "person",
            place_label: "Columbus, OH",
            trust_level: "atlas_verified",
            source_count: 4,
          },
          relationships: [
            { type: "shared_place", issue_area_ids: [], source_ids: [] },
            {
              type: "shared_issue_area",
              issue_area_ids: ["housing"],
              source_ids: [],
            },
          ],
        },
        {
          entity: {
            id: "e2",
            name: "Acme Org",
            type: "organization",
            place_label: null,
            trust_level: "unverified",
            source_count: 0,
          },
          relationships: [
            { type: "affiliated_organization", issue_area_ids: [], source_ids: [] },
          ],
        },
      ],
      total: 8,
      next_cursor: "2",
    });
  });

  it("defaults next_cursor to null when it's absent", () => {
    const parsed = parseConnectionsData({ entity_id: "e0", items: [], total: 0 });
    expect(parsed?.next_cursor).toBeNull();
  });

  it("defaults next_cursor to null when it's present but not a string", () => {
    const parsed = parseConnectionsData({
      entity_id: "e0",
      items: [],
      total: 0,
      next_cursor: 2,
    });
    expect(parsed?.next_cursor).toBeNull();
  });

  it("defaults relationships to an empty array when the field is missing", () => {
    const parsed = parseConnectionsData({
      entity_id: "e0",
      items: [{ entity: FULL_ENTITY_PAYLOAD }],
      total: 1,
      next_cursor: null,
    });
    expect(parsed?.items[0]?.relationships).toEqual([]);
  });

  it("drops non-string entries from issue_area_ids and source_ids", () => {
    const parsed = parseConnectionsData({
      entity_id: "e0",
      items: [
        {
          entity: FULL_ENTITY_PAYLOAD,
          relationships: [
            {
              type: "shared_issue_area",
              issue_area_ids: ["housing", 42, null],
              source_ids: ["src-1", false],
            },
          ],
        },
      ],
      total: 1,
      next_cursor: null,
    });
    expect(parsed?.items[0]?.relationships[0]).toEqual({
      type: "shared_issue_area",
      issue_area_ids: ["housing"],
      source_ids: ["src-1"],
    });
  });

  it("drops an individual malformed item with a console warning, keeping the rest", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const parsed = parseConnectionsData({
      entity_id: "e0",
      items: [{ entity: FULL_ENTITY_PAYLOAD, relationships: [] }, { nope: true }],
      total: 2,
      next_cursor: null,
    });

    expect(parsed?.items).toHaveLength(1);
    expect(parsed?.items[0]?.entity.id).toBe("e1");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("dropped a list item"),
      { nope: true },
    );
    warnSpy.mockRestore();
  });

  it("drops a non-object item within items", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const parsed = parseConnectionsData({
      entity_id: "e0",
      items: ["not an object"],
      total: 1,
      next_cursor: null,
    });

    expect(parsed?.items).toHaveLength(0);
    warnSpy.mockRestore();
  });

  it("drops an item whose entity doesn't parse into SearchResultRow", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const parsed = parseConnectionsData({
      entity_id: "e0",
      items: [{ entity: { nope: true }, relationships: [] }],
      total: 1,
      next_cursor: null,
    });

    expect(parsed?.items).toHaveLength(0);
    warnSpy.mockRestore();
  });

  it("drops a malformed relationship within an item, keeping the rest of that item's relationships", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const parsed = parseConnectionsData({
      entity_id: "e0",
      items: [
        {
          entity: FULL_ENTITY_PAYLOAD,
          relationships: [{ type: "shared_place" }, { nope: true }],
        },
      ],
      total: 1,
      next_cursor: null,
    });

    expect(parsed?.items[0]?.relationships).toHaveLength(1);
    expect(parsed?.items[0]?.relationships[0]?.type).toBe("shared_place");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("dropped a relationship"),
      { nope: true },
    );
    warnSpy.mockRestore();
  });

  it("drops a non-object relationship entry", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const parsed = parseConnectionsData({
      entity_id: "e0",
      items: [{ entity: FULL_ENTITY_PAYLOAD, relationships: ["not an object"] }],
      total: 1,
      next_cursor: null,
    });

    expect(parsed?.items[0]?.relationships).toHaveLength(0);
    warnSpy.mockRestore();
  });

  it("drops a relationship whose type is not a string", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const parsed = parseConnectionsData({
      entity_id: "e0",
      items: [{ entity: FULL_ENTITY_PAYLOAD, relationships: [{ type: 123 }] }],
      total: 1,
      next_cursor: null,
    });

    expect(parsed?.items[0]?.relationships).toHaveLength(0);
    warnSpy.mockRestore();
  });

  it("returns null for null input", () => {
    expect(parseConnectionsData(null)).toBeNull();
  });

  it("returns null for a non-object input", () => {
    expect(parseConnectionsData("not an object")).toBeNull();
  });

  it("returns null when entity_id is not a string", () => {
    expect(parseConnectionsData({ entity_id: 123, items: [], total: 0 })).toBeNull();
  });

  it("returns null when items is not an array", () => {
    expect(
      parseConnectionsData({ entity_id: "e0", items: "not an array", total: 0 }),
    ).toBeNull();
  });

  it("returns null when total is not a number", () => {
    expect(
      parseConnectionsData({ entity_id: "e0", items: [], total: "eight" }),
    ).toBeNull();
  });
});
