// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/access", () => ({
  DeviceApprovalCompletePage: () => <div data-testid="device-approved" />,
}));

vi.mock("@/domains/access/server", () => ({
  requireAtlasSession: vi.fn(),
}));

describe("routes/_auth/device.approved", () => {
  beforeEach(async () => {
    const { resetRouterMocks } = await import("@/../tests/helpers/router-harness");
    resetRouterMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("requires a signed-in Atlas session before showing completion", async () => {
    const routeModule = await import("@/routes/_auth/device/approved");
    const access = await import("@/domains/access/server");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    if (!Route.options.beforeLoad) throw new Error("Expected beforeLoad");
    await Route.options.beforeLoad({ location: { href: "/device/approved" } });

    expect(access.requireAtlasSession).toHaveBeenCalledWith("/device/approved");
  });

  it("renders the device approval completion page", async () => {
    const routeModule = await import("@/routes/_auth/device/approved");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");

    render(<Component />);

    expect(screen.getByTestId("device-approved")).toBeInTheDocument();
  });
});
