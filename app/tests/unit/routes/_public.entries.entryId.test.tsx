// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { captureRouterRedirect } from "@/../tests/fixtures/routes/redirect-capture";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/lib/api", () => ({
  api: {
    entries: {
      get: vi.fn(),
    },
  },
}));

describe("routes/_public/entries/$entryId", () => {
  it("redirects person entries to the canonical people profile URL", async () => {
    const { api } = await import("@/lib/api");
    vi.mocked(api.entries.get).mockResolvedValueOnce({
      type: "person",
      slug: "jane-doe",
    } as Awaited<ReturnType<typeof api.entries.get>>);

    const routeModule = await import("@/routes/_public/entries.$entryId");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    if (!Route.options.loader) throw new Error("Expected loader");
    const loader = Route.options.loader;
    const captured = await captureRouterRedirect(() =>
      loader({ params: { entryId: "ent_1" } } as never),
    );
    expect(captured.isRedirect).toBe(true);
    expect(captured.options.to).toBe("/profiles/people/$slug");
    expect(captured.options.params).toEqual({ slug: "jane-doe" });
    expect(captured.options.statusCode).toBe(301);
  });

  it("redirects organization entries to the canonical organization profile URL", async () => {
    const { api } = await import("@/lib/api");
    vi.mocked(api.entries.get).mockResolvedValueOnce({
      type: "organization",
      slug: "acme",
    } as Awaited<ReturnType<typeof api.entries.get>>);

    const routeModule = await import("@/routes/_public/entries.$entryId");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    if (!Route.options.loader) throw new Error("Expected loader");
    const loader = Route.options.loader;
    const captured = await captureRouterRedirect(() =>
      loader({ params: { entryId: "ent_2" } } as never),
    );
    expect(captured.options.to).toBe("/profiles/organizations/$slug");
    expect(captured.options.params).toEqual({ slug: "acme" });
    expect(captured.options.statusCode).toBe(301);
  });

  it.each([
    ["initiative", "/profiles/initiatives/$slug"],
    ["campaign", "/profiles/campaigns/$slug"],
    ["event", "/profiles/events/$slug"],
  ])("redirects %s entries to their dedicated detail URL", async (type, expectedRoute) => {
    const { api } = await import("@/lib/api");
    vi.mocked(api.entries.get).mockResolvedValueOnce({
      type,
      slug: `${type}-slug`,
    } as Awaited<ReturnType<typeof api.entries.get>>);

    const routeModule = await import("@/routes/_public/entries.$entryId");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    if (!Route.options.loader) throw new Error("Expected loader");
    const loader = Route.options.loader;
    const captured = await captureRouterRedirect(() =>
      loader({ params: { entryId: "ent_3" } } as never),
    );
    expect(captured.options.to).toBe(expectedRoute);
    expect(captured.options.params).toEqual({ slug: `${type}-slug` });
    expect(captured.options.statusCode).toBe(301);
  });

  it("falls back to /browse for non-actor entries with no canonical detail URL", async () => {
    const { api } = await import("@/lib/api");
    vi.mocked(api.entries.get).mockResolvedValueOnce({
      type: "initiative",
      slug: null,
    } as unknown as Awaited<ReturnType<typeof api.entries.get>>);

    const routeModule = await import("@/routes/_public/entries.$entryId");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    if (!Route.options.loader) throw new Error("Expected loader");
    const loader = Route.options.loader;
    const captured = await captureRouterRedirect(() =>
      loader({ params: { entryId: "ent_3" } } as never),
    );
    expect(captured.options.to).toBe("/browse");
    expect(captured.options.statusCode).toBe(302);
  });

  it("falls back to /browse when person entries lack a slug", async () => {
    const { api } = await import("@/lib/api");
    vi.mocked(api.entries.get).mockResolvedValueOnce({
      type: "person",
      slug: null,
    } as unknown as Awaited<ReturnType<typeof api.entries.get>>);

    const routeModule = await import("@/routes/_public/entries.$entryId");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    if (!Route.options.loader) throw new Error("Expected loader");
    const loader = Route.options.loader;
    const captured = await captureRouterRedirect(() =>
      loader({ params: { entryId: "ent_4" } } as never),
    );
    expect(captured.options.to).toBe("/browse");
  });

  it("renders nothing for the route component (it is a redirect-only route)", async () => {
    const routeModule = await import("@/routes/_public/entries.$entryId");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    const callable = Component as unknown as () => unknown;
    expect(callable()).toBe(null);
  });
});
