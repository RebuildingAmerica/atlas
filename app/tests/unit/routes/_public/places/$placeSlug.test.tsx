// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import { placePageFixture } from "@/../tests/fixtures/catalog/place-page";
import type { PageHead } from "@/platform/seo";
import type { PlacePageData } from "@/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  api: {
    places: {
      getPage: vi.fn(),
      listActors: vi.fn(),
    },
  },
}));

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/lib/api", () => ({
  api: mocks.api,
}));

vi.mock("@/domains/catalog/pages/place-page", () => ({
  PlacePage: ({ data }: { data: PlacePageData }) => (
    <div data-testid="place-page" data-name={data.identity.name} />
  ),
}));

describe("routes/_public/places/$placeSlug", () => {
  beforeEach(async () => {
    const { resetRouterMocks } = await import("@/../tests/helpers/router-harness");
    resetRouterMocks();
    mocks.api.places.getPage.mockReset();
    mocks.api.places.listActors.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("loads the place page bundle for the slug", async () => {
    mocks.api.places.getPage.mockResolvedValueOnce(placePageFixture);

    const routeModule = await import("@/routes/_public/places/$placeSlug");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    const result = await Route.options.loader?.({
      params: { placeSlug: "las-vegas-nv" },
    });

    expect(mocks.api.places.getPage).toHaveBeenCalledWith("las-vegas-nv");
    expect(result).toBe(placePageFixture);
  });

  it("publishes canonical metadata for the public place URL", async () => {
    const routeModule = await import("@/routes/_public/places/$placeSlug");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    const head = Route.options.head?.({
      loaderData: placePageFixture,
      params: { placeSlug: "las-vegas-nv" },
    }) as PageHead;

    expect(head.meta).toEqual(
      expect.arrayContaining([
        { title: "Las Vegas | Atlas" },
        {
          name: "description",
          content:
            "People, organizations, public records, issues, facts, government, and places in Las Vegas, NV",
        },
        {
          property: "og:url",
          content: "https://atlas.rebuildingamerica.com/places/las-vegas-nv",
        },
      ]),
    );
    expect(head.links).toContainEqual({
      rel: "canonical",
      href: "https://atlas.rebuildingamerica.com/places/las-vegas-nv",
    });
  });

  it("renders the loaded place page data", async () => {
    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    const router = readRouterMocks();
    router.useLoaderData.mockReturnValue(placePageFixture);

    const routeModule = await import("@/routes/_public/places/$placeSlug");
    const Route = asRouteStub(routeModule.Route);
    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");

    const view = render(<Component />);

    expect(view.getByTestId("place-page").dataset.name).toBe("Las Vegas");
  });
});
