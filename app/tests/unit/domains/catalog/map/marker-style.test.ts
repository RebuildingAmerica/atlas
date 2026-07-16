import { describe, expect, it } from "vitest";
import {
  CIVIC_NAVY,
  clusterBubbleStyle,
  dotMarkerStyle,
} from "@rebuildingamerica/atlas-catalog/map/marker-style";
import { ISSUE_COLORS } from "@rebuildingamerica/atlas-catalog/map/issue-colors";
import { makePoint } from "../../../../helpers/catalog/map-clustering-harness";

describe("dotMarkerStyle", () => {
  it("fills the core with the primary issue color", () => {
    const style = dotMarkerStyle(makePoint({ id: "x", issue_areas: ["climate-resilience"] }));
    expect(style.fill).toBe(ISSUE_COLORS.climate);
  });

  it("rings subject-verified and atlas-verified actors in civic navy at full opacity", () => {
    for (const level of ["subject_verified", "atlas_verified"] as const) {
      const style = dotMarkerStyle(makePoint({ id: "v", trust_level: level }));
      expect(style.ringColor).toBe(CIVIC_NAVY);
      expect(style.ringWidth).toBeGreaterThan(0);
      expect(style.opacity).toBe(1);
    }
  });

  it("rings a corroborated actor in a darker shade of its own issue color", () => {
    const style = dotMarkerStyle(
      makePoint({ id: "c", trust_level: "corroborated", issue_areas: ["housing-affordability"] }),
    );
    expect(style.ringWidth).toBeGreaterThan(0);
    // A darker ring than the fill, derived from the same hue (not navy).
    expect(style.ringColor).not.toBe(CIVIC_NAVY);
    expect(style.ringColor).not.toBe(style.fill);
    expect(style.opacity).toBe(1);
  });

  it("gives an unverified actor no ring and a quieter 80% opacity (silence is honest)", () => {
    const style = dotMarkerStyle(makePoint({ id: "u", trust_level: "unverified" }));
    expect(style.ringWidth).toBe(0);
    expect(style.opacity).toBeCloseTo(0.8);
  });

  it("falls back to the neutral stone when an actor has no issue areas", () => {
    const style = dotMarkerStyle(makePoint({ id: "n", issue_areas: [] }));
    expect(style.fill).toBe("#a89880");
  });

  it("shapes the dot by actor type", () => {
    expect(dotMarkerStyle(makePoint({ id: "p", type: "person" })).shape).toBe("circle");
    expect(dotMarkerStyle(makePoint({ id: "o", type: "organization" })).shape).toBe("squircle");
    expect(dotMarkerStyle(makePoint({ id: "i", type: "initiative" })).shape).toBe("diamond");
  });

  it("treats campaigns and events as their nearest shape rather than inventing a new one", () => {
    expect(dotMarkerStyle(makePoint({ id: "c", type: "campaign" })).shape).toBe("diamond");
    expect(dotMarkerStyle(makePoint({ id: "e", type: "event" })).shape).toBe("diamond");
  });
});

describe("clusterBubbleStyle", () => {
  it("grows the bubble with density", () => {
    const small = clusterBubbleStyle(2);
    const large = clusterBubbleStyle(500);
    expect(large.diameter).toBeGreaterThan(small.diameter);
  });

  it("caps the bubble so one giant cluster never swallows the map", () => {
    const huge = clusterBubbleStyle(100000);
    const capped = clusterBubbleStyle(1000000);
    expect(huge.diameter).toBe(capped.diameter);
  });

  it("warms from stone toward accent as density climbs", () => {
    const sparse = clusterBubbleStyle(2);
    const dense = clusterBubbleStyle(800);
    expect(sparse.background).not.toBe(dense.background);
  });

  it("formats a small count verbatim and abbreviates a large one", () => {
    expect(clusterBubbleStyle(7).label).toBe("7");
    expect(clusterBubbleStyle(1298).label).toBe("1.3k");
  });
});
