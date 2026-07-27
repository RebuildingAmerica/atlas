// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@rebuildingamerica/atlas-api-client", async () => {
  const support =
    await import("@/../tests/unit/routes/_public/places/place-slug-route-test-support");
  return support.installPlaceApiMock();
});

describe("routes/_public/places/boroughs/$placeSlug", () => {
  beforeEach(async () => {
    const { resetRouterMocks } = await import("@/../tests/helpers/router-harness");
    resetRouterMocks();
  });

  it("loads the borough by slug and renders it under a borough-specific canonical URL", async () => {
    const support =
      await import("@/../tests/unit/routes/_public/places/place-slug-route-test-support");
    const routeModule = await import("@/routes/_public/places/boroughs/$placeSlug");

    await support.expectPlaceSlugRoute({
      canonicalPath: "/places/boroughs/brooklyn-ny",
      data: support.placeRouteFixture({
        display: "Brooklyn, NY",
        kind: "borough",
        name: "Brooklyn",
        slug: "brooklyn-ny",
      }),
      kind: "borough",
      route: routeModule.Route,
    });
  });
});
