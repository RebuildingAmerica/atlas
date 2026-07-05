// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeviceApprovalPageProps } from "@/domains/access/pages/auth/device-approval-page";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/access", () => {
  return {
    DeviceApprovalPage: ({ status, userCode }: DeviceApprovalPageProps) => (
      <div
        data-status={status ?? ""}
        data-testid="device-approval"
        data-user-code={userCode ?? ""}
      />
    ),
    deviceApprovalSearchSchema: { __schema: "device" },
  };
});

describe("routes/_auth/device/index", () => {
  beforeEach(async () => {
    const { resetRouterMocks } = await import("@/../tests/helpers/router-harness");
    resetRouterMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("registers the device approval search schema", async () => {
    const routeModule = await import("@/routes/_auth/device/index");
    const { deviceApprovalSearchSchema } = await import("@/domains/access");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    expect(Route.options.validateSearch).toBe(deviceApprovalSearchSchema);
  });

  it("forwards the user code to DeviceApprovalPage", async () => {
    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    readRouterMocks().useSearch.mockReturnValue({ status: "failed", user_code: "ABCD-EFGH" });

    const routeModule = await import("@/routes/_auth/device/index");
    const Route = asRouteStub(routeModule.Route);
    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");

    const view = render(<Component />);

    expect(view.getByTestId("device-approval").dataset.userCode).toBe("ABCD-EFGH");
    expect(view.getByTestId("device-approval").dataset.status).toBe("failed");
  });
});
