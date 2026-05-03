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

vi.mock("@/domains/access/organizations.functions", () => ({
  getOrganizationDetails: vi.fn(),
}));

describe("routes/_workspace/organization/index", () => {
  beforeEach(async () => {
    const { resetRouterMocks } = await import("@/../tests/helpers/router-harness");
    resetRouterMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("loads organization details into the route context before rendering", async () => {
    const fns = await import("@/domains/access/organizations.functions");
    const initialOrganization = { id: "org_1", name: "Acme" };
    vi.mocked(fns.getOrganizationDetails).mockResolvedValue(
      initialOrganization as Awaited<ReturnType<typeof fns.getOrganizationDetails>>,
    );

    const routeModule = await import("@/routes/_workspace/organization.index");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    if (!Route.options.beforeLoad) throw new Error("Expected beforeLoad");
    const ctx = await Route.options.beforeLoad({});
    expect(ctx).toEqual({ initialOrganization });
  });

  it("renders OrganizationPage with the route context organization", async () => {
    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    const router = readRouterMocks();
    router.useRouteContext.mockReturnValue({ initialOrganization: { id: "org_1" } });

    const routeModule = await import("@/routes/_workspace/organization.index");
    const Route = asRouteStub(routeModule.Route);

    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    const view = render(<Component />);
    expect(view.getByTestId("organization-page").dataset.initial).toBe(
      JSON.stringify({ id: "org_1" }),
    );
  });
});
