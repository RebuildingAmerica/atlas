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

describe("routes/_public/places/metros/$placeSlug", () => {
  beforeEach(async () => {
    const { resetRouterMocks } = await import("@/../tests/helpers/router-harness");
    resetRouterMocks();
  });

  it("loads the metro area by slug and renders it under a metro area-specific canonical URL", async () => {
    const support =
      await import("@/../tests/unit/routes/_public/places/place-slug-route-test-support");
    const routeModule = await import("@/routes/_public/places/metros/$placeSlug");

    await support.expectPlaceSlugRoute({
      canonicalPath: "/places/metros/las-vegas-henderson-paradise-nv",
      data: support.placeRouteFixture({
        display: "Las Vegas-Henderson-Paradise, NV Metro Area",
        kind: "metro",
        name: "Las Vegas-Henderson-Paradise",
        slug: "las-vegas-henderson-paradise-nv",
      }),
      kind: "metro",
      route: routeModule.Route,
    });
  });
});
