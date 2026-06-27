import { describe, expect, it } from "vitest";
import { buildCanonicalUrl } from "@/platform/seo";

describe("SEO helpers", () => {
  it("builds canonical URLs from the production origin by default", () => {
    expect(buildCanonicalUrl("/profiles/people/jane")).toBe(
      "https://atlas.rebuildingamerica.com/profiles/people/jane",
    );
  });

  it("uses the configured public origin for canonical URLs", () => {
    expect(
      buildCanonicalUrl("profiles/people/jane", {
        ATLAS_PUBLIC_URL: "https://preview.atlas.localhost/",
      }),
    ).toBe("https://preview.atlas.localhost/profiles/people/jane");
  });
});
