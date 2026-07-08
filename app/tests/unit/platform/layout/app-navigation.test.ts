import { describe, expect, it } from "vitest";
import { createAtlasSessionFixture } from "@/../tests/fixtures/access/sessions";
import { buildAuthenticatedAppNav } from "@/platform/layout/app-navigation";

describe("buildAuthenticatedAppNav", () => {
  it("surfaces profile verifications only for local review sessions", () => {
    const signedInItems = buildAuthenticatedAppNav(createAtlasSessionFixture());
    expect(signedInItems).not.toContainEqual({
      label: "Verifications",
      to: "/admin/profile-claims",
    });

    const localItems = buildAuthenticatedAppNav(createAtlasSessionFixture({ isLocal: true }));
    expect(localItems).toContainEqual({
      label: "Verifications",
      to: "/admin/profile-claims",
    });
  });
});
