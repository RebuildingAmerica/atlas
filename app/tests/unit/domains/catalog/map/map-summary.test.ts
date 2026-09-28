import { describe, expect, it } from "vitest";
import { announceViewport } from "@rebuildingamerica/atlas-catalog/map/map-summary";

describe("map-summary", () => {
  describe("announceViewport", () => {
    it("announces the count for assistive technology", () => {
      expect(announceViewport(14)).toBe("Showing 14 people and groups.");
    });

    it("speaks in the singular for one result", () => {
      expect(announceViewport(1)).toBe("Showing 1 person or group.");
    });

    it("announces an empty viewport plainly", () => {
      expect(announceViewport(0)).toBe("No people or groups here.");
    });
  });
});
