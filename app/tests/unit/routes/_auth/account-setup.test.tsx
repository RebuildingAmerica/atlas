// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/access", () => ({
  AccountSetupPage: ({ redirectTo }: { redirectTo?: string }) => (
    <div data-testid="account-setup-page" data-redirect={redirectTo ?? ""} />
  ),
}));

vi.mock("@/domains/access/server", () => ({
  requireIncompleteAtlasSession: vi.fn(),
}));

describe("routes/_auth/account-setup", () => {
  beforeEach(async () => {
    const { resetRouterMocks } = await import("@/../tests/helpers/router-harness");
    resetRouterMocks();
    const access = await import("@/domains/access/server");
    vi.mocked(access.requireIncompleteAtlasSession).mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("validates the search payload to a redirect-only schema", async () => {
    const routeModule = await import("@/routes/_auth/account-setup");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    const validator = Route.options.validateSearch as { parse: (input: unknown) => unknown };
    expect(validator.parse({ redirect: "/dashboard" })).toEqual({ redirect: "/dashboard" });
    expect(validator.parse({})).toEqual({});
  });

  it("requires an incomplete session through the route guard", async () => {
    const access = await import("@/domains/access/server");
    const session = { user: { id: "u1" } };
    vi.mocked(access.requireIncompleteAtlasSession).mockResolvedValue(
      session as Awaited<ReturnType<typeof access.requireIncompleteAtlasSession>>,
    );

    const routeModule = await import("@/routes/_auth/account-setup");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    if (!Route.options.beforeLoad) throw new Error("Expected beforeLoad");
    const ctx = await Route.options.beforeLoad({
      location: { href: "/account-setup?redirect=/x" },
      search: { redirect: "/x" },
    });
    expect(access.requireIncompleteAtlasSession).toHaveBeenCalledWith(
      "/account-setup?redirect=/x",
      "/x",
    );
    expect(ctx).toEqual({ session });
  });

  it("forwards the redirect search param into AccountSetupPage", async () => {
    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    const router = readRouterMocks();
    router.useSearch.mockReturnValue({ redirect: "/billing" });

    const routeModule = await import("@/routes/_auth/account-setup");
    const Route = asRouteStub(routeModule.Route);

    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    const view = render(<Component />);
    expect(view.getByTestId("account-setup-page").dataset.redirect).toBe("/billing");
  });
});
