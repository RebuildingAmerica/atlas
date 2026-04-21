import { describe, expect, it } from "vitest";
import { buildWorkspaceSlugCandidate } from "@/domains/access/components/organization/organization-page-helpers";

describe("organization-page-helpers", () => {
  describe("buildWorkspaceSlugCandidate", () => {
    it("normalizes names into valid slugs", () => {
      expect(buildWorkspaceSlugCandidate("Atlas Team")).toBe("atlas-team");
      expect(buildWorkspaceSlugCandidate("Research & Discovery!")).toBe("research-discovery");
      expect(buildWorkspaceSlugCandidate("  Trim Me  ")).toBe("trim-me");
    });

    it("handles consecutive special characters", () => {
      expect(buildWorkspaceSlugCandidate("Too---Many---Dashes")).toBe("too-many-dashes");
      expect(buildWorkspaceSlugCandidate("Spaces   and   Tabs")).toBe("spaces-and-tabs");
    });

    it("removes leading and trailing dashes", () => {
      expect(buildWorkspaceSlugCandidate("-Leading")).toBe("leading");
      expect(buildWorkspaceSlugCandidate("Trailing-")).toBe("trailing");
    });

    it("limits slug length to 64 characters", () => {
      const longName = "a".repeat(100);
      expect(buildWorkspaceSlugCandidate(longName)).toHaveLength(64);
    });
  });
});
