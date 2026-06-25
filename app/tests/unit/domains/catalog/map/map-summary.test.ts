import { describe, expect, it } from "vitest";
import { announceViewport, sparsityPill } from "@/domains/catalog/map/map-summary";
import { makePoint } from "../../../../helpers/catalog/map-clustering-harness";
import type { MapPoint } from "@/types";

describe("map-summary", () => {
  describe("sparsityPill", () => {
    it("counts actors and the distinct places they sit in", () => {
      const points: MapPoint[] = [
        makePoint({ id: "1", lat: 32.78, lng: -96.8 }),
        makePoint({ id: "2", lat: 32.78, lng: -96.8 }),
        makePoint({ id: "3", lat: 30.27, lng: -97.74 }),
      ];
      expect(sparsityPill(points)).toBe(
        "Atlas is mapping civic work — 3 actors in 2 places so far",
      );
    });

    it("speaks in the singular for a single actor in a single place", () => {
      expect(sparsityPill([makePoint({ id: "1", lat: 1, lng: 2 })])).toBe(
        "Atlas is mapping civic work — 1 actor in 1 place so far",
      );
    });

    it("returns null when there is nothing to celebrate", () => {
      expect(sparsityPill([])).toBeNull();
    });
  });

  describe("announceViewport", () => {
    it("announces the count for assistive technology", () => {
      expect(announceViewport(14)).toBe("Showing 14 civic actors on the map.");
    });

    it("speaks in the singular for one actor", () => {
      expect(announceViewport(1)).toBe("Showing 1 civic actor on the map.");
    });

    it("announces an empty viewport plainly", () => {
      expect(announceViewport(0)).toBe("No civic actors in this part of the map.");
    });
  });
});
