// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/access", () => {
  interface MockDeviceApprovalProps {
    userCode?: string;
  }

  return {
    DeviceApprovalPage: ({ userCode }: MockDeviceApprovalProps) => (
      <div data-testid="device-approval" data-user-code={userCode ?? ""} />
    ),
    deviceApprovalSearchSchema: { __schema: "device" },
  };
});

vi.mock("@/domains/access/server", () => ({
  requireAtlasSession: vi.fn(),
}));

describe("routes/_auth/device", () => {
  beforeEach(async () => {
    const { resetRouterMocks } = await import("@/../tests/helpers/router-harness");
    resetRouterMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("disables SSR and registers the device approval search schema", async () => {
    const routeModule = await import("@/routes/_auth/device");
    const { deviceApprovalSearchSchema } = await import("@/domains/access");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    expect(Route.options.ssr).toBe(false);
    expect(Route.options.validateSearch).toBe(deviceApprovalSearchSchema);
  });

  it("requires a signed-in Atlas session before approval", async () => {
    const routeModule = await import("@/routes/_auth/device");
    const access = await import("@/domains/access/server");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    if (!Route.options.beforeLoad) throw new Error("Expected beforeLoad");
    await Route.options.beforeLoad({ location: { href: "/device?user_code=ABCD-EFGH" } });

    expect(access.requireAtlasSession).toHaveBeenCalledWith("/device?user_code=ABCD-EFGH");
  });

  it("forwards the user code to DeviceApprovalPage", async () => {
    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    readRouterMocks().useSearch.mockReturnValue({ user_code: "ABCD-EFGH" });

    const routeModule = await import("@/routes/_auth/device");
    const Route = asRouteStub(routeModule.Route);
    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");

    const view = render(<Component />);

    expect(view.getByTestId("device-approval").dataset.userCode).toBe("ABCD-EFGH");
  });
});
