// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/platform/pages/privacy-page", () => ({
  PrivacyPage: () => null,
}));

describe("routes/_public/privacy", () => {
  it("registers the PrivacyPage component", async () => {
    const { Route } = await import("@/routes/_public/privacy");
    const { PrivacyPage } = await import("@/platform/pages/privacy-page");
    expect(Route.options.component).toBe(PrivacyPage);
  });

  it("publishes SEO metadata for the privacy page", async () => {
    const { Route } = await import("@/routes/_public/privacy");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const route = asRouteStub(Route);
    expect(route.options.head?.({})).toEqual({
      meta: [
        { title: "Privacy | Atlas" },
        {
          name: "description",
          content: "How Atlas handles account, billing, usage, and public-source civic data.",
        },
      ],
    });
  });
});
