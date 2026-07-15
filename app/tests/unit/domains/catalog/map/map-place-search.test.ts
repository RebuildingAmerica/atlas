import { describe, expect, it } from "vitest";
import { searchActors, searchPlaces } from "@/domains/catalog/map/map-place-search";
import { makePoint } from "../../../../helpers/catalog/map-clustering-harness";
import type { MapPoint } from "@rebuildingamerica/atlas-api-client";

describe("map-place-search", () => {
  describe("searchPlaces", () => {
    it("returns nothing for a blank query so the menu stays quiet until asked", () => {
      expect(searchPlaces("")).toEqual([]);
      expect(searchPlaces("   ")).toEqual([]);
    });

    it("matches a city by name and carries its coordinate and city filter", () => {
      const results = searchPlaces("Dallas");
      const dallas = results.find((place) => place.label === "Dallas, TX");
      expect(dallas).toBeDefined();
      expect(dallas?.kind).toBe("city");
      expect(dallas?.anchor).toEqual({ lng: -96.8, lat: 32.78 });
      expect(dallas?.cityKey).toBe("Dallas, TX");
      expect(dallas?.stateCode).toBe("TX");
    });

    it("matches a state by name and carries a centroid plus its state filter", () => {
      const results = searchPlaces("Texas");
      const texas = results.find((place) => place.kind === "state" && place.label === "Texas");
      expect(texas).toBeDefined();
      expect(texas?.stateCode).toBe("TX");
      expect(texas?.cityKey).toBeUndefined();
      expect(typeof texas?.anchor.lng).toBe("number");
      expect(typeof texas?.anchor.lat).toBe("number");
    });

    it("matches case-insensitively and trims the query", () => {
      expect(searchPlaces("  seattle ").some((place) => place.label === "Seattle, WA")).toBe(true);
    });

    it("ignores a state with no cities to anchor a fly-to on", () => {
      // Wyoming is in the state grid but absent from the city table, so there is
      // nowhere honest to fly to — it simply does not appear as a place.
      expect(searchPlaces("Wyoming").some((place) => place.stateCode === "WY")).toBe(false);
    });

    it("caps the result list so the command menu never floods", () => {
      // "a" appears in a huge number of city names; the list stays bounded.
      expect(searchPlaces("a").length).toBeLessThanOrEqual(8);
    });
  });

  describe("searchActors", () => {
    const points: MapPoint[] = [
      makePoint({ id: "1", name: "Greater Dallas Housing Trust" }),
      makePoint({ id: "2", name: "Austin Tenants Union" }),
      makePoint({ id: "3", name: "Houston Mutual Aid" }),
    ];

    it("returns nothing for a blank query", () => {
      expect(searchActors("", points)).toEqual([]);
    });

    it("matches actors whose name contains the query, case-insensitively", () => {
      const results = searchActors("dallas", points);
      expect(results).toHaveLength(1);
      expect(results[0]?.name).toBe("Greater Dallas Housing Trust");
    });

    it("caps the actor matches so the menu never floods", () => {
      const many = Array.from({ length: 20 }, (_, i) =>
        makePoint({ id: `m${i}`, name: `Housing Group ${i}` }),
      );
      expect(searchActors("housing", many).length).toBeLessThanOrEqual(8);
    });
  });
});
