// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { PageHead } from "@/platform/seo";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/platform/pages/home-page", () => ({
  HomePage: () => null,
}));

describe("routes/_public/index", () => {
  it("registers the HomePage component for the public landing route", async () => {
    const { Route } = await import("@/routes/_public/index");
    const { HomePage } = await import("@/platform/pages/home-page");
    expect(Route.options.component).toBe(HomePage);
  });

  it("frames the public home route as source-linked local civic intelligence", async () => {
    const { Route } = await import("@/routes/_public/index");
    if (!Route.options.head) throw new Error("Expected head metadata");

    const head = Route.options.head({} as never) as PageHead;

    expect(head.meta).toContainEqual({ title: "Atlas | Source-Linked Local Civic Intelligence" });
    expect(head.meta).toContainEqual({
      name: "description",
      content:
        "Find source-linked local civic intelligence by person, organization, issue, and place.",
    });
    expect(head.meta).toEqual(
      expect.arrayContaining([
        {
          property: "og:url",
          content: "https://atlas.rebuildingamerica.com",
        },
        {
          property: "og:image",
          content: "https://atlas.rebuildingamerica.com/social/atlas-card.png",
        },
        { name: "twitter:card", content: "summary_large_image" },
      ]),
    );
    expect(head.links).toContainEqual({
      rel: "canonical",
      href: "https://atlas.rebuildingamerica.com",
    });
  });
});
