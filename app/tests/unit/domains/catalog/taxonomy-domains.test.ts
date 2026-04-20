import { describe, expect, it } from "vitest";
import { groupIssueAreasByDomain } from "@/domains/catalog/taxonomy-domains";

describe("taxonomy-domains", () => {
  it("groups known issue areas by their domain", () => {
    const issueAreas = [
      "housing_affordability",
      "zoning_and_land_use",
      "automation_and_ai_displacement",
    ];
    const grouped = groupIssueAreasByDomain(issueAreas);

    expect(grouped.size).toBe(2);
    expect(grouped.get("Housing & Built Environment")).toEqual([
      "housing_affordability",
      "zoning_and_land_use",
    ]);
    expect(grouped.get("Economic Security")).toEqual(["automation_and_ai_displacement"]);
  });

  it("ignores unknown issue areas", () => {
    const issueAreas = ["unknown_area"];
    const grouped = groupIssueAreasByDomain(issueAreas);
    expect(grouped.size).toBe(0);
  });
});
