import { describe, expect, it } from "vitest";
import { formatRelationshipLabel } from "./relationship-labels";

describe("formatRelationshipLabel", () => {
  it.each([
    ["affiliated_organization", "Same organization"],
    ["affiliated_member", "Affiliated member"],
    ["shared_place", "Same place"],
    ["shared_source", "Shared source"],
  ])("labels %s as %s", (type, expected) => {
    expect(
      formatRelationshipLabel({ type, issue_area_ids: [], source_ids: [] }),
    ).toBe(expected);
  });

  it("builds a shared-issue label listing each humanized issue area", () => {
    expect(
      formatRelationshipLabel({
        type: "shared_issue_area",
        issue_area_ids: ["housing", "criminal-justice"],
        source_ids: [],
      }),
    ).toBe("Shared issue: Housing, Criminal Justice");
  });

  it("falls back to a generic label when shared_issue_area has no issue area ids", () => {
    expect(
      formatRelationshipLabel({
        type: "shared_issue_area",
        issue_area_ids: [],
        source_ids: [],
      }),
    ).toBe("Shared issue area");
  });

  it("humanizes an unrecognized relationship type instead of showing the raw value", () => {
    expect(
      formatRelationshipLabel({
        type: "future_relationship_kind",
        issue_area_ids: [],
        source_ids: [],
      }),
    ).toBe("Future Relationship Kind");
  });
});
