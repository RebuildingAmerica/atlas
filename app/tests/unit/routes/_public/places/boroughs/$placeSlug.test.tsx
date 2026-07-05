// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { placeBoroughRouteFixture } from "@/../tests/fixtures/catalog/place-page";
import type { PageHead } from "@/platform/seo";
import type { PlacePageData } from "@/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

describe("routes/_public/places/boroughs/$placeSlug", () => {
  beforeEach(async () => {
    const { resetRouterMocks } = await import("@/../tests/helpers/router-harness");
    resetRouterMocks();
    mocks.api.places.getPage.mockReset();
    mocks.api.places.listActors.mockReset();
  });

  it("uses the shared place data loader with a borough-specific canonical URL", async () => {
    mocks.api.places.getPage.mockResolvedValueOnce(placeBoroughRouteFixture);

    const routeModule = await import("@/routes/_public/places/boroughs/$placeSlug");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    const result = await Route.options.loader?.({
      params: { placeSlug: "brooklyn-ny" },
    });
    const head = Route.options.head?.({
      loaderData: placeBoroughRouteFixture,
      params: { placeSlug: "brooklyn-ny" },
    }) as PageHead;

    expect(result).toBe(placeBoroughRouteFixture);
    expect(mocks.api.places.getPage).toHaveBeenCalledWith("brooklyn-ny");
    expect(head.links).toContainEqual({
      rel: "canonical",
      href: "https://atlas.rebuildingamerica.com/places/boroughs/brooklyn-ny",
    });
  });
});
