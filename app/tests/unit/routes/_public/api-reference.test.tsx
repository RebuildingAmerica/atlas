import type { PageHead } from "@/platform/seo";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/platform/config/app-config", () => ({
  getApiDocsUrl: vi.fn(),
}));

describe("routes/_public/api-reference", () => {
  beforeEach(async () => {
    const { resetRouterMocks } = await import("@/../tests/helpers/router-harness");
    resetRouterMocks();
    const config = await import("@/platform/config/app-config");
    vi.mocked(config.getApiDocsUrl).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws an explanatory error when ATLAS_API_DOCS_URL is unset", async () => {
    const config = await import("@/platform/config/app-config");
    vi.mocked(config.getApiDocsUrl).mockReturnValue(undefined);

    const routeModule = await import("@/routes/_public/api-reference");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    if (!Route.options.loader) throw new Error("Expected loader");
    expect(() => Route.options.loader?.({})).toThrow(
      /ATLAS_API_DOCS_URL is not set/,
    );
  });

  it("redirects to the configured API-origin Scalar reference", async () => {
    const config = await import("@/platform/config/app-config");
    vi.mocked(config.getApiDocsUrl).mockReturnValue("https://api.atlas.test/docs");

    const routeModule = await import("@/routes/_public/api-reference");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    if (!Route.options.loader) throw new Error("Expected loader");
    try {
      Route.options.loader({});
      throw new Error("Expected redirect");
    } catch (error) {
      expect((error as { isRedirect?: boolean }).isRedirect).toBe(true);
      expect((error as { options: { href: string; statusCode: number } }).options).toEqual({
        href: "https://api.atlas.test/docs",
        statusCode: 308,
      });
    }
  });

  it("publishes API reference metadata", async () => {
    const routeModule = await import("@/routes/_public/api-reference");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    const head = Route.options.head?.({}) as PageHead;

    expect(head.meta).toEqual(
      expect.arrayContaining([
        { title: "API Reference | Atlas" },
        {
          name: "description",
          content: "Explore the generated Atlas REST API reference.",
        },
      ]),
    );
  });
});
