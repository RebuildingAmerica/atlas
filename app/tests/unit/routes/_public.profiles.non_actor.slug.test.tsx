// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/catalog/components/entries/entry-detail", () => ({
  EntryDetail: ({ entry }: { entry: { name?: string } }) => (
    <div data-testid="entry-detail">{entry.name}</div>
  ),
}));

vi.mock("@/domains/catalog/server/profiles/profile-loaders", () => ({
  loadProfileBySlug: vi.fn(),
}));

describe.each([
  {
    modulePath: "@/routes/_public/profiles/initiatives.$slug",
    scope: "initiatives",
    title: "Initiative",
    canonicalPath: "/profiles/initiatives",
  },
  {
    modulePath: "@/routes/_public/profiles/campaigns.$slug",
    scope: "campaigns",
    title: "Campaign",
    canonicalPath: "/profiles/campaigns",
  },
  {
    modulePath: "@/routes/_public/profiles/events.$slug",
    scope: "events",
    title: "Event",
    canonicalPath: "/profiles/events",
  },
])("non-actor profile route $scope", ({ modulePath, scope, title, canonicalPath }) => {
  beforeEach(async () => {
    const { resetRouterMocks } = await import("@/../tests/helpers/router-harness");
    resetRouterMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("loads the entity by scoped slug and exposes canonical SEO meta", async () => {
    const { loadProfileBySlug } = await import("@/domains/catalog/server/profiles/profile-loaders");
    const entry = {
      id: `${scope}-1`,
      name: `Source-Linked ${title}`,
      slug: `${scope}-slug`,
      description: `${title} page description`.repeat(10),
    };
    vi.mocked(loadProfileBySlug).mockResolvedValue(
      entry as Awaited<ReturnType<typeof loadProfileBySlug>>,
    );

    const routeModule = (await import(modulePath)) as { Route: unknown };
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    if (!Route.options.loader) throw new Error("Expected loader");
    const loaded = await Route.options.loader({ params: { slug: `${scope}-slug` } });
    expect(loadProfileBySlug).toHaveBeenCalledWith({
      data: { type: scope, slug: `${scope}-slug` },
    });
    expect(loaded).toEqual({ entry });

    if (!Route.options.head) throw new Error("Expected head");
    const headPayload = Route.options.head({ loaderData: { entry } }) as {
      meta: Record<string, string>[];
      links: Record<string, string>[];
    };
    expect(headPayload.meta).toEqual(
      expect.arrayContaining([{ title: `Source-Linked ${title} — ${title} | Atlas` }]),
    );
    expect(headPayload.links[0]).toEqual({
      rel: "canonical",
      href: `https://atlas.rebuildingamerica.com${canonicalPath}/${scope}-slug`,
    });
  });

  it("renders the source-linked entry detail surface with loader data", async () => {
    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    const router = readRouterMocks();
    router.useLoaderData.mockReturnValue({
      entry: { name: `Source-Linked ${title}` },
    });

    const routeModule = (await import(modulePath)) as { Route: unknown };
    const Route = asRouteStub(routeModule.Route);

    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);
    expect(screen.getByTestId("entry-detail")).toHaveTextContent(`Source-Linked ${title}`);
  });
});
