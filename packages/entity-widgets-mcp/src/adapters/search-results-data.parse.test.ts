import { describe, expect, it, vi } from "vitest";
import { parseSearchResultsData } from "./search-results-data";
import {
  FULL_ENTITY_PAYLOAD,
  MINIMAL_ENTITY_PAYLOAD,
} from "./test-support/entity-fixtures";

const SEARCH_RESULTS_PAYLOAD = {
  items: [FULL_ENTITY_PAYLOAD, MINIMAL_ENTITY_PAYLOAD],
  total: 12,
  next_cursor: "2",
};

describe("parseSearchResultsData", () => {
  it("narrows a full EntityCollectionResponse-shaped payload down to SearchResultsData", () => {
    expect(parseSearchResultsData(SEARCH_RESULTS_PAYLOAD)).toEqual({
      items: [
        {
          id: "e1",
          name: "Jane Doe",
          type: "person",
          place_label: "Columbus, OH",
          trust_level: "atlas_verified",
          source_count: 4,
        },
        {
          id: "e2",
          name: "Acme Org",
          type: "organization",
          place_label: null,
          trust_level: "unverified",
          source_count: 0,
        },
      ],
      total: 12,
      next_cursor: "2",
    });
  });

  it("defaults next_cursor to null when it's absent", () => {
    const parsed = parseSearchResultsData({ items: [], total: 0 });
    expect(parsed?.next_cursor).toBeNull();
  });

  it("defaults next_cursor to null when it's present but not a string", () => {
    const parsed = parseSearchResultsData({
      items: [],
      total: 0,
      next_cursor: 2,
    });
    expect(parsed?.next_cursor).toBeNull();
  });

  it("drops an individual malformed item with a console warning, keeping the rest", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const parsed = parseSearchResultsData({
      items: [FULL_ENTITY_PAYLOAD, { nope: true }],
      total: 2,
      next_cursor: null,
    });

    expect(parsed?.items).toHaveLength(1);
    expect(parsed?.items[0]?.id).toBe("e1");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("dropped a list item"),
      { nope: true },
    );
    warnSpy.mockRestore();
  });

  it("returns null for null input", () => {
    expect(parseSearchResultsData(null)).toBeNull();
  });

  it("returns null for a non-object input", () => {
    expect(parseSearchResultsData("not an object")).toBeNull();
  });

  it("returns null when items is not an array", () => {
    expect(
      parseSearchResultsData({ items: "not an array", total: 0 }),
    ).toBeNull();
  });

  it("returns null when total is not a number", () => {
    expect(
      parseSearchResultsData({ items: [], total: "twelve" }),
    ).toBeNull();
  });
});
