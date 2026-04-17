import { describe, expect, it } from "vitest";
import {
  ENTITY_TYPE_LABELS,
  FEATURED_ENTRY_TYPES,
  FEATURED_SOURCE_TYPES,
  SOURCE_TYPE_LABELS,
  humanize,
} from "@/domains/catalog/catalog";
import { STATE_NAME_BY_CODE, US_STATE_GRID } from "@/domains/catalog/us-state-grid";

describe("catalog surface data", () => {
  it("exposes human-readable labels for entry and source types", () => {
    expect(ENTITY_TYPE_LABELS.person).toBe("People");
    expect(SOURCE_TYPE_LABELS.government_record).toBe("Government records");
    expect(humanize("worker_cooperatives")).toBe("Worker Cooperatives");
  });

  it("defines featured browse filters and the state grid mapping", () => {
    expect(FEATURED_ENTRY_TYPES).toContain("organization");
    expect(FEATURED_SOURCE_TYPES).toContain("podcast");
    expect(US_STATE_GRID.find((state) => state.code === "CA")).toEqual({
      code: "CA",
      col: 0,
      name: "California",
      row: 2,
    });
    expect(STATE_NAME_BY_CODE.MO).toBe("Missouri");
  });
});
