import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/platform/config/app-config", () => ({
  getDocsUrl: vi.fn(),
}));

describe("routes/docs", () => {
  beforeEach(async () => {
    const { resetRouterMocks } = await import("@/../tests/helpers/router-harness");
    resetRouterMocks();
    const config = await import("@/platform/config/app-config");
    vi.mocked(config.getDocsUrl).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does nothing when the pathname is deeper than /docs", async () => {
    const routeModule = await import("@/routes/docs");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    if (!Route.options.loader) throw new Error("Expected loader");
    expect(Route.options.loader({ location: { pathname: "/docs/mcp" } })).toBeUndefined();
  });

  it("throws an explanatory error when ATLAS_DOCS_URL is unset for the bare /docs path", async () => {
    const config = await import("@/platform/config/app-config");
    vi.mocked(config.getDocsUrl).mockReturnValue(undefined);

    const routeModule = await import("@/routes/docs");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    if (!Route.options.loader) throw new Error("Expected loader");
    const loader = Route.options.loader;
    expect(() => loader({ location: { pathname: "/docs/" } })).toThrow(/ATLAS_DOCS_URL is not set/);
  });

  it("throws a redirect to the configured docs origin for the bare /docs path", async () => {
    const config = await import("@/platform/config/app-config");
    vi.mocked(config.getDocsUrl).mockReturnValue("https://docs.atlas.test");

    const routeModule = await import("@/routes/docs");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    if (!Route.options.loader) throw new Error("Expected loader");
    const loader = Route.options.loader;
    expect(() => loader({ location: { pathname: "/docs" } })).toThrow("Redirect");
  });
});
