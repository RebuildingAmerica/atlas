import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/platform/config/app-config", () => ({
  getDocsUrl: vi.fn(),
}));

describe("routes/docs/$ catch-all redirect", () => {
  beforeEach(async () => {
    const { resetRouterMocks } = await import("@/../tests/helpers/router-harness");
    resetRouterMocks();
    const config = await import("@/platform/config/app-config");
    vi.mocked(config.getDocsUrl).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws an explanatory error when ATLAS_DOCS_URL is unset", async () => {
    const config = await import("@/platform/config/app-config");
    vi.mocked(config.getDocsUrl).mockReturnValue(undefined);

    const routeModule = await import("@/routes/docs/$");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    if (!Route.options.loader) throw new Error("Expected loader");
    const loader = Route.options.loader;
    expect(() => loader({ params: { _splat: "mcp" } })).toThrow(/ATLAS_DOCS_URL is not set/);
  });

  it("redirects to the docs subpath when a splat is present", async () => {
    const config = await import("@/platform/config/app-config");
    vi.mocked(config.getDocsUrl).mockReturnValue("https://docs.atlas.test/");

    const routeModule = await import("@/routes/docs/$");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    if (!Route.options.loader) throw new Error("Expected loader");
    try {
      Route.options.loader({ params: { _splat: "mcp" } });
      throw new Error("Expected redirect");
    } catch (error) {
      expect((error as { isRedirect?: boolean }).isRedirect).toBe(true);
      expect((error as { options: { href: string } }).options.href).toBe(
        "https://docs.atlas.test/mcp",
      );
    }
  });

  it("redirects to the docs origin when no splat is present", async () => {
    const config = await import("@/platform/config/app-config");
    vi.mocked(config.getDocsUrl).mockReturnValue("https://docs.atlas.test");

    const routeModule = await import("@/routes/docs/$");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    if (!Route.options.loader) throw new Error("Expected loader");
    try {
      Route.options.loader({ params: { _splat: undefined } });
      throw new Error("Expected redirect");
    } catch (error) {
      expect((error as { isRedirect?: boolean }).isRedirect).toBe(true);
      expect((error as { options: { href: string } }).options.href).toBe("https://docs.atlas.test");
    }
  });
});
