import { describe, expect, it } from "vitest";
import { createAtlasSessionFixture } from "@/../tests/fixtures/access/sessions";
import { buildAuthenticatedAppNav } from "@/platform/layout/app-navigation";

describe("buildAuthenticatedAppNav", () => {
  it("surfaces operator admin pages only for local review sessions", () => {
    const signedInItems = buildAuthenticatedAppNav(createAtlasSessionFixture());
    expect(signedInItems).not.toContainEqual({
      label: "Admin",
      to: "/admin",
    });

    const localItems = buildAuthenticatedAppNav(createAtlasSessionFixture({ isLocal: true }));
    expect(localItems).toContainEqual({
      label: "Admin",
      to: "/admin",
    });
  });
});
