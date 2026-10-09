import { describe, expect, it } from "vitest";
import { createAtlasSessionFixture } from "@/../tests/fixtures/access/sessions";
import { buildAuthenticatedAppNav } from "@/platform/layout/app-navigation";

describe("buildAuthenticatedAppNav", () => {
  it("shows editorial work only to the people who run this instance", () => {
    const editorial = { label: "Editorial", to: "/editorial" };

    expect(buildAuthenticatedAppNav(createAtlasSessionFixture())).not.toContainEqual(editorial);
    expect(
      buildAuthenticatedAppNav(createAtlasSessionFixture({ isInstanceOperator: true })),
    ).toContainEqual(editorial);
    expect(buildAuthenticatedAppNav(createAtlasSessionFixture({ isLocal: true }))).toContainEqual(
      editorial,
    );
  });
});
