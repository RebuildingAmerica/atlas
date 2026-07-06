// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/access/pages/workspace/organization-page", () => ({
  OrganizationPage: ({ initialOrganization }: { initialOrganization: unknown }) => (
    <div
      data-testid="organization-page"
      data-initial={JSON.stringify(initialOrganization ?? null)}
    />
  ),
}));

describe("routes/_workspace/organization/index", () => {
  beforeEach(async () => {
    const { resetRouterMocks } = await import("@/../tests/helpers/router-harness");
    resetRouterMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("does not eager-load organization details before rendering", async () => {
    const routeModule = await import("@/routes/_workspace/organization/index");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    expect(Route.options.beforeLoad).toBeUndefined();
  });

  it("renders OrganizationPage without an initial organization payload", async () => {
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const routeModule = await import("@/routes/_workspace/organization/index");
    const Route = asRouteStub(routeModule.Route);

    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    const view = render(<Component />);
    expect(view.getByTestId("organization-page").dataset.initial).toBe(JSON.stringify(null));
  });
});
