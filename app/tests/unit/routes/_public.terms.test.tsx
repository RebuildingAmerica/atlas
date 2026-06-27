// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/platform/pages/terms-page", () => ({
  TermsPage: () => null,
}));

describe("routes/_public/terms", () => {
  it("registers the TermsPage component", async () => {
    const { Route } = await import("@/routes/_public/terms");
    const { TermsPage } = await import("@/platform/pages/terms-page");
    expect(Route.options.component).toBe(TermsPage);
  });

  it("publishes SEO metadata for the terms page", async () => {
    const { Route } = await import("@/routes/_public/terms");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const route = asRouteStub(Route);
    expect(route.options.head?.({})).toEqual({
      meta: [
        { title: "Terms | Atlas" },
        {
          name: "description",
          content:
            "Terms for using Atlas public profiles, workspaces, subscriptions, and source-linked data.",
        },
      ],
    });
  });
});
