// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/platform/pages/security-page", () => ({
  SecurityPage: () => null,
}));

describe("routes/_public/security", () => {
  it("registers the SecurityPage component", async () => {
    const { Route } = await import("@/routes/_public/security");
    const { SecurityPage } = await import("@/platform/pages/security-page");
    expect(Route.options.component).toBe(SecurityPage);
  });

  it("publishes SEO metadata for the security page", async () => {
    const { Route } = await import("@/routes/_public/security");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const route = asRouteStub(Route);
    expect(route.options.head?.({})).toEqual({
      meta: [
        { title: "Security | Atlas" },
        {
          name: "description",
          content:
            "Atlas security practices for account access, infrastructure, and responsible disclosure.",
        },
      ],
    });
  });
});
