// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { DiscoveryReviewsPage } from "@/domains/admin/discovery-reviews-page";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("../../helpers/router-harness");
  return harness.installRouterMocks();
});

describe("admin discovery review route", () => {
  it("mounts the review page at its workspace route", async () => {
    const routeModule = await import("@/routes/_workspace/admin/discovery-reviews");
    const { asRouteStub } = await import("../../helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    expect(Route.options.component).toBe(DiscoveryReviewsPage);
  });
});
