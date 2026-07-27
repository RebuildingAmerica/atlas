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

describe("routes/_public/places/neighborhoods/$placeSlug", () => {
  beforeEach(async () => {
    const { resetRouterMocks } = await import("@/../tests/helpers/router-harness");
    resetRouterMocks();
  });

  it("loads the neighborhood by slug and renders it under a neighborhood-specific canonical URL", async () => {
    const support =
      await import("@/../tests/unit/routes/_public/places/place-slug-route-test-support");
    const routeModule = await import("@/routes/_public/places/neighborhoods/$placeSlug");

    await support.expectPlaceSlugRoute({
      canonicalPath: "/places/neighborhoods/historic-westside-las-vegas-nv",
      data: support.placeRouteFixture({
        display: "Historic Westside, Las Vegas, NV",
        kind: "neighborhood",
        name: "Historic Westside",
        slug: "historic-westside-las-vegas-nv",
      }),
      kind: "neighborhood",
      route: routeModule.Route,
    });
  });
});
