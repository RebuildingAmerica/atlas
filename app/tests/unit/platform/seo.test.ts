import { describe, expect, it } from "vitest";
import { buildCanonicalUrl, buildPageHead } from "@/platform/seo";

describe("SEO helpers", () => {
  it("builds canonical URLs from the production origin by default", () => {
    expect(buildCanonicalUrl("/profiles/people/jane")).toBe(
      "https://atlas.rebuildingamerica.com/profiles/people/jane",
    );
  });

  it("builds the canonical origin for the root path", () => {
    expect(buildCanonicalUrl("")).toBe("https://atlas.rebuildingamerica.com");
  });

  it("uses the configured public origin for canonical URLs", () => {
    expect(
      buildCanonicalUrl("profiles/people/jane", {
        ATLAS_PUBLIC_URL: "https://preview.atlas.localhost/",
      }),
    ).toBe("https://preview.atlas.localhost/profiles/people/jane");
  });

  it("builds canonical and social metadata for public pages", () => {
    expect(
      buildPageHead(
        {
          title: "Browse | Atlas",
          description: "Find people and groups by place, issue, name, and source.",
          path: "/browse",
        },
        { ATLAS_PUBLIC_URL: "https://preview.atlas.example/app" },
      ),
    ).toEqual({
      meta: [
        { title: "Browse | Atlas" },
        {
          name: "description",
          content: "Find people and groups by place, issue, name, and source.",
        },
        { property: "og:title", content: "Browse | Atlas" },
        {
          property: "og:description",
          content: "Find people and groups by place, issue, name, and source.",
        },
        { property: "og:type", content: "website" },
        { property: "og:url", content: "https://preview.atlas.example/browse" },
        { property: "og:site_name", content: "Atlas" },
        {
          property: "og:image",
          content: "https://preview.atlas.example/social/atlas-card.png",
        },
        { property: "og:image:width", content: "1200" },
        { property: "og:image:height", content: "630" },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: "Browse | Atlas" },
        {
          name: "twitter:description",
          content: "Find people and groups by place, issue, name, and source.",
        },
        {
          name: "twitter:image",
          content: "https://preview.atlas.example/social/atlas-card.png",
        },
      ],
      links: [{ rel: "canonical", href: "https://preview.atlas.example/browse" }],
    });
  });
});
