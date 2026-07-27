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

describe("routes/_public/places/counties/$placeSlug", () => {
  beforeEach(async () => {
    const { resetRouterMocks } = await import("@/../tests/helpers/router-harness");
    resetRouterMocks();
  });

  it("loads the county by slug and renders it under a county-specific canonical URL", async () => {
    const support =
      await import("@/../tests/unit/routes/_public/places/place-slug-route-test-support");
    const routeModule = await import("@/routes/_public/places/counties/$placeSlug");

    await support.expectPlaceSlugRoute({
      canonicalPath: "/places/counties/clark-county-nv",
      data: support.placeRouteFixture({
        display: "Clark County, NV",
        kind: "county",
        name: "Clark County",
        slug: "clark-county-nv",
      }),
      kind: "county",
      route: routeModule.Route,
    });
  });
});
