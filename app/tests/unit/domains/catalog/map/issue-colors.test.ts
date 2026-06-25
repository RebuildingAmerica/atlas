import { describe, expect, it } from "vitest";
import { FALLBACK_ISSUE_COLOR, ISSUE_COLORS, issueColor } from "@/domains/catalog/map/issue-colors";

describe("issueColor", () => {
  it("maps a known issue-area slug to its warm-stone hue by prefix", () => {
    expect(issueColor("housing-affordability")).toBe(ISSUE_COLORS.housing);
    expect(issueColor("labor-organizing")).toBe(ISSUE_COLORS.labor);
    expect(issueColor("CLIMATE-resilience")).toBe(ISSUE_COLORS.climate);
  });

  it("matches a bare slug with no qualifier", () => {
    expect(issueColor("democracy")).toBe(ISSUE_COLORS.democracy);
  });

  it("falls back to the neutral stone for an unknown prefix", () => {
    expect(issueColor("transit-equity")).toBe(FALLBACK_ISSUE_COLOR);
  });

  it("falls back to the neutral stone for an empty slug", () => {
    expect(issueColor("")).toBe(FALLBACK_ISSUE_COLOR);
  });
});
