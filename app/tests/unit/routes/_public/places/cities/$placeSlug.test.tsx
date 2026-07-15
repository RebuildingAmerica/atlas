// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { placeCityRouteFixture } from "@/../tests/fixtures/catalog/place-page";
import type { PageHead } from "@/platform/seo";
import type { PlacePageData } from "@rebuildingamerica/atlas-api-client";
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

vi.mock("@rebuildingamerica/atlas-api-client", () => ({
  api: mocks.api,
}));

vi.mock("@/domains/catalog/pages/place-page", () => ({
  PlacePage: ({ data }: { data: PlacePageData }) => (
    <div data-testid="place-page" data-name={data.identity.name} />
  ),
}));

describe("routes/_public/places/cities/$placeSlug", () => {
  beforeEach(async () => {
    const { resetRouterMocks } = await import("@/../tests/helpers/router-harness");
    resetRouterMocks();
    mocks.api.places.getPage.mockReset();
    mocks.api.places.listActors.mockReset();
  });

  it("uses the same place data loader with a city-specific canonical URL", async () => {
    mocks.api.places.getPage.mockResolvedValueOnce(placeCityRouteFixture);

    const routeModule = await import("@/routes/_public/places/cities/$placeSlug");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    const result = await Route.options.loader?.({
      params: { placeSlug: "las-vegas-nv" },
    });
    const head = Route.options.head?.({
      loaderData: placeCityRouteFixture,
      params: { placeSlug: "las-vegas-nv" },
    }) as PageHead;

    expect(result).toBe(placeCityRouteFixture);
    expect(mocks.api.places.getPage).toHaveBeenCalledWith("las-vegas-nv", { kind: "city" });
    expect(head.links).toContainEqual({
      rel: "canonical",
      href: "https://atlas.rebuildingamerica.com/places/cities/las-vegas-nv",
    });
  });
});
