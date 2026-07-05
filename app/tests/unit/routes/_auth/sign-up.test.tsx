// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/access/pages/auth/sign-up-page", () => ({
  SignUpPage: (props: Record<string, unknown>) => (
    <div data-testid="sign-up-page" data-props={JSON.stringify(props)} />
  ),
}));

vi.mock("@/domains/access/server", () => ({
  redirectIfLocalSession: vi.fn(),
}));

describe("routes/_auth/sign-up", () => {
  beforeEach(async () => {
    const { resetRouterMocks } = await import("@/../tests/helpers/router-harness");
    resetRouterMocks();
    const access = await import("@/domains/access/server");
    vi.mocked(access.redirectIfLocalSession).mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("validates the sign-up search payload and redirects local sessions", async () => {
    const routeModule = await import("@/routes/_auth/sign-up");
    const access = await import("@/domains/access/server");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    const validator = Route.options.validateSearch as { parse: (input: unknown) => unknown };
    expect(validator.parse({ intent: "team-sso", redirect: "/x" })).toEqual({
      intent: "team-sso",
      redirect: "/x",
    });
    expect(validator.parse({})).toEqual({});

    if (!Route.options.beforeLoad) throw new Error("Expected beforeLoad");
    Route.options.beforeLoad({});
    expect(access.redirectIfLocalSession).toHaveBeenCalledWith("/discovery");
  });

  it("forwards intent and redirect search params to SignUpPage", async () => {
    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    const router = readRouterMocks();
    router.useSearch.mockReturnValue({ intent: "team-sso", redirect: "/billing" });

    const routeModule = await import("@/routes/_auth/sign-up");
    const Route = asRouteStub(routeModule.Route);

    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    const view = render(<Component />);
    const props = JSON.parse(view.getByTestId("sign-up-page").dataset.props ?? "{}") as {
      intent?: string;
      redirectTo?: string;
    };
    expect(props.intent).toBe("team-sso");
    expect(props.redirectTo).toBe("/billing");
  });
});
