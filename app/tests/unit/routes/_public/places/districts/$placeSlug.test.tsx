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

describe("routes/_public/places/districts/$placeSlug", () => {
  beforeEach(async () => {
    const { resetRouterMocks } = await import("@/../tests/helpers/router-harness");
    resetRouterMocks();
  });

  it("loads the district by slug and renders it under a district-specific canonical URL", async () => {
    const support =
      await import("@/../tests/unit/routes/_public/places/place-slug-route-test-support");
    const routeModule = await import("@/routes/_public/places/districts/$placeSlug");

    await support.expectPlaceSlugRoute({
      canonicalPath: "/places/districts/nv-01",
      data: support.placeRouteFixture({
        display: "Nevada's 1st Congressional District, NV",
        kind: "district",
        name: "Nevada's 1st Congressional District",
        slug: "nv-01",
      }),
      kind: "district",
      route: routeModule.Route,
    });
  });
});
