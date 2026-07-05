import { describe, expect, it } from "vitest";
import { announceViewport, sparsityPill } from "@/domains/catalog/map/map-summary";
import { makePoint } from "../../../../helpers/catalog/map-clustering-harness";
import type { MapPoint } from "@/types";

describe("map-summary", () => {
  describe("sparsityPill", () => {
    it("counts people and groups and the distinct places they sit in", () => {
      const points: MapPoint[] = [
        makePoint({ id: "1", lat: 32.78, lng: -96.8 }),
        makePoint({ id: "2", lat: 32.78, lng: -96.8 }),
        makePoint({ id: "3", lat: 30.27, lng: -97.74 }),
      ];
      expect(sparsityPill(points)).toBe("3 people and groups in 2 places");
    });

    it("speaks in the singular for one result in one place", () => {
      expect(sparsityPill([makePoint({ id: "1", lat: 1, lng: 2 })])).toBe(
        "1 person or group in 1 place",
      );
    });

    it("returns null when there is nothing to celebrate", () => {
      expect(sparsityPill([])).toBeNull();
    });
  });

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
