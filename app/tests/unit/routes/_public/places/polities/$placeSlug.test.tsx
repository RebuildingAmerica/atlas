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

describe("routes/_public/places/polities/$placeSlug", () => {
  beforeEach(async () => {
    const { resetRouterMocks } = await import("@/../tests/helpers/router-harness");
    resetRouterMocks();
  });

  it("loads the polity by slug and renders it under a polity-specific canonical URL", async () => {
    const support =
      await import("@/../tests/unit/routes/_public/places/place-slug-route-test-support");
    const routeModule = await import("@/routes/_public/places/polities/$placeSlug");

    await support.expectPlaceSlugRoute({
      canonicalPath: "/places/polities/las-vegas-nv",
      data: support.placeRouteFixture({
        display: "Las Vegas, NV",
        kind: "polity",
        name: "Las Vegas",
        slug: "las-vegas-nv",
      }),
      kind: "polity",
      route: routeModule.Route,
    });
  });
});
