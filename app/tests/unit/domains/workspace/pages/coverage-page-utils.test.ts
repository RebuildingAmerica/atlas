import { describe, expect, it } from "vitest";
import { formatStableDateTime } from "@rebuildingamerica/atlas-ui/format/date-time";
import {
  downloadTextFile,
  formatDate,
  joined,
} from "@/domains/workspace/pages/coverage-page-utils";

describe("coverage page utilities", () => {
  it("says nothing is listed rather than showing an empty line", () => {
    expect(joined([])).toBe("None listed");
    expect(joined(["housing_affordability"])).toBe("housing affordability");
  });

  it("separates a target never reviewed from a timestamp it cannot read", () => {
    expect(formatDate(formatStableDateTime, null)).toBe("Not reviewed");
    expect(formatDate(formatStableDateTime, "not-a-date")).toBe("Unknown");
    expect(formatDate(formatStableDateTime, "2026-07-02T00:00:00Z")).toBe("Jul 2, 2026");
  });

  it("does nothing when there is no document to hang a download off", () => {
    expect(() => {
      downloadTextFile("atlas-coverage.csv", "name,geography\n", "text/csv");
    }).not.toThrow();
  });
});
