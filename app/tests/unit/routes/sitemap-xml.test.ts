import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/lib/api", () => ({
  api: {
    entries: {
      list: vi.fn(),
    },
  },
}));

describe("routes/sitemap.xml", () => {
  it("emits an XML sitemap with profile URLs and skips entries without a slug", async () => {
    const { api } = await import("@/lib/api");
    vi.mocked(api.entries.list).mockImplementation(((
      params: { entry_types?: string[] } | undefined,
    ) => {
      if (params?.entry_types?.includes("person")) {
        return Promise.resolve({
          data: [
            {
              type: "person",
              slug: "jane-doe",
              updated_at: "2024-04-01T12:34:56Z",
            },
            {
              type: "person",
              slug: null,
              updated_at: "2024-04-01T12:34:56Z",
            },
          ],
        });
      }
      return Promise.resolve({
        data: [
          {
            type: "organization",
            slug: "acme",
            updated_at: "2024-04-02T00:00:00Z",
          },
        ],
      });
    }) as typeof api.entries.list);

    const routeModule = await import("@/routes/sitemap[.]xml");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const handlers = Route.options.server?.handlers;
    if (!handlers?.GET) throw new Error("Expected GET handler");
    const response = (await handlers.GET({})) as Response;

    expect(response.headers.get("Content-Type")).toBe("application/xml; charset=utf-8");
    const body = await response.text();
    expect(body).toContain("https://atlas.rebuildingamerica.com/profiles/people/jane-doe");
    expect(body).toContain("https://atlas.rebuildingamerica.com/profiles/organizations/acme");
    expect(body).toContain("<lastmod>2024-04-01</lastmod>");
    expect(body).not.toContain("/profiles/people/null");
  });

  it("renders the static sitemap header when no entries are returned", async () => {
    const { api } = await import("@/lib/api");
    vi.mocked(api.entries.list).mockResolvedValue({ data: undefined } as unknown as Awaited<
      ReturnType<typeof api.entries.list>
    >);

    const routeModule = await import("@/routes/sitemap[.]xml");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const handlers = Route.options.server?.handlers;
    if (!handlers?.GET) throw new Error("Expected GET handler");
    const response = (await handlers.GET({})) as Response;
    const body = await response.text();
    expect(body).toContain("https://atlas.rebuildingamerica.com</loc>");
    expect(body).toContain("https://atlas.rebuildingamerica.com/browse</loc>");
  });
});
