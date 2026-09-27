// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { CorrectionInboxPage } from "@/domains/admin/correction-inbox-page";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("../../helpers/router-harness");
  return harness.installRouterMocks();
});

describe("admin corrections route", () => {
  it("mounts the private operator inbox", async () => {
    const routeModule = await import("@/routes/_workspace/admin/corrections");
    const { asRouteStub } = await import("../../helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    expect(Route.options.component).toBe(CorrectionInboxPage);
  });
});
