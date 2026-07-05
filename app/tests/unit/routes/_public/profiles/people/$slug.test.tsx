// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, cleanup } from "@testing-library/react";
import type { PageHead } from "@/platform/seo";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/catalog/pages/profiles/detail/person-profile-page", () => ({
  PersonProfilePage: ({ entry }: { entry: { name?: string } }) => (
    <div data-testid="person-profile" data-name={entry.name ?? ""} />
  ),
}));

vi.mock("@/domains/catalog/server/profiles/profile-loaders", () => ({
  loadProfileBySlug: vi.fn(),
  loadProfileConnections: vi.fn(),
}));

describe("routes/_public/profiles/people/$slug", () => {
  beforeEach(async () => {
    const { resetRouterMocks } = await import("@/../tests/helpers/router-harness");
    resetRouterMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("loads the person by slug and exposes canonical SEO meta", async () => {
    const { loadProfileBySlug, loadProfileConnections } =
      await import("@/domains/catalog/server/profiles/profile-loaders");
    const entry = {
      id: "jane-1",
      name: "Jane",
      slug: "jane",
      description: "Bio of Jane.".repeat(20),
      photo_url: "https://images.example/jane.jpg",
    };
    vi.mocked(loadProfileBySlug).mockResolvedValue(
      entry as Awaited<ReturnType<typeof loadProfileBySlug>>,
    );

    const routeModule = await import("@/routes/_public/profiles/people/$slug");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    if (!Route.options.loader) throw new Error("Expected loader");
    const loaded = await Route.options.loader({ params: { slug: "jane" } });
    expect(loadProfileBySlug).toHaveBeenCalledWith({
      data: { type: "people", slug: "jane" },
    });
    expect(loadProfileConnections).not.toHaveBeenCalled();
    expect(loaded).toEqual({ entry });

    if (!Route.options.head) throw new Error("Expected head");
    const headPayload = Route.options.head({ loaderData: { entry } }) as PageHead;
    expect(headPayload.meta).toEqual(expect.arrayContaining([{ title: "Jane — Person | Atlas" }]));
    expect(headPayload.meta).toEqual(
      expect.arrayContaining([
        {
          property: "og:image",
          content: "https://images.example/jane.jpg",
        },
        {
          name: "twitter:image",
          content: "https://images.example/jane.jpg",
        },
      ]),
    );
    expect(headPayload.links[0]).toEqual({
      rel: "canonical",
      href: "https://atlas.rebuildingamerica.com/profiles/people/jane",
    });
  });

  it("returns an empty head payload when loader data is missing", async () => {
    const routeModule = await import("@/routes/_public/profiles/people/$slug");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    if (!Route.options.head) throw new Error("Expected head");
    expect(Route.options.head({ loaderData: undefined })).toEqual({});
    expect(Route.options.head({ loaderData: {} })).toEqual({});
  });

  it("uses an empty description fallback when the entry omits one", async () => {
    const routeModule = await import("@/routes/_public/profiles/people/$slug");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    const entry = { name: "Jane", slug: "jane", description: null };
    if (!Route.options.head) throw new Error("Expected head");
    const headPayload = Route.options.head({ loaderData: { entry } }) as PageHead;
    expect(headPayload.meta).toEqual(
      expect.arrayContaining([{ name: "description", content: "" }]),
    );
  });

  it("uses the default social card when a person profile has no photo", async () => {
    const routeModule = await import("@/routes/_public/profiles/people/$slug");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    const entry = { name: "Jane", slug: "jane", description: null, photo_url: " " };
    if (!Route.options.head) throw new Error("Expected head");
    const headPayload = Route.options.head({ loaderData: { entry } }) as PageHead;
    expect(headPayload.meta).toEqual(
      expect.arrayContaining([
        {
          property: "og:image",
          content: "https://atlas.rebuildingamerica.com/social/atlas-card.png",
        },
        {
          name: "twitter:image",
          content: "https://atlas.rebuildingamerica.com/social/atlas-card.png",
        },
      ]),
    );
  });

  it("renders PersonProfilePage with the loader entry", async () => {
    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    const router = readRouterMocks();
    router.useLoaderData.mockReturnValue({ entry: { name: "Jane" } });

    const routeModule = await import("@/routes/_public/profiles/people/$slug");
    const Route = asRouteStub(routeModule.Route);

    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    const view = render(<Component />);
    expect(view.getByTestId("person-profile").dataset.name).toBe("Jane");
  });
});
