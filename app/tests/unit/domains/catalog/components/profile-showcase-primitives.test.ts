import { describe, expect, it } from "vitest";
import { buildScopeCopy } from "@/domains/catalog/components/profiles/profile-showcase-primitives";

describe("profile showcase primitives", () => {
  it("frames profile overviews as source-linked research records rather than directories", () => {
    expect(buildScopeCopy("people").description).toContain(
      "Source-linked records for people working across public record, place, and issue.",
    );
    expect(buildScopeCopy("people").description).not.toMatch(/directory|surfaced/i);

    expect(buildScopeCopy("organizations").description).toContain(
      "Source-linked records for organizations grounded in local reporting, public records, and research context.",
    );
    expect(buildScopeCopy("organizations").description).not.toMatch(/directory|surfaced/i);

    expect(buildScopeCopy("all").description).toContain(
      "Explore source-linked people and organizations by issue, place, and public record.",
    );
    expect(buildScopeCopy("all").description).not.toMatch(/Wander|surfaced/i);
  });
});
