// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/access", () => ({
  SignInPage: (props: Record<string, unknown>) => (
    <div data-testid="sign-in-page" data-props={JSON.stringify(props)} />
  ),
  signInSearchSchema: { __schema: "sign-in" },
}));

vi.mock("@/domains/access/server", () => ({
  redirectIfLocalSession: vi.fn(),
}));

describe("routes/_auth/sign-in", () => {
  beforeEach(async () => {
    const { resetRouterMocks } = await import("@/../tests/helpers/router-harness");
    resetRouterMocks();
    const access = await import("@/domains/access/server");
    vi.mocked(access.redirectIfLocalSession).mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("registers the sign-in search schema and redirects local sessions", async () => {
    const routeModule = await import("@/routes/_auth/sign-in");
    const { signInSearchSchema } = await import("@/domains/access");
    const access = await import("@/domains/access/server");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    expect(Route.options.validateSearch).toBe(signInSearchSchema);
    if (!Route.options.beforeLoad) throw new Error("Expected beforeLoad");
    Route.options.beforeLoad({});
    expect(access.redirectIfLocalSession).toHaveBeenCalledWith("/discovery");
  });

  it("forwards search params to SignInPage", async () => {
    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    const router = readRouterMocks();
    router.useSearch.mockReturnValue({
      error: "missing_provider",
      existing: true,
      email: "ops@acme.test",
      invitation: "inv_1",
      redirect: "/discovery",
    });

    const routeModule = await import("@/routes/_auth/sign-in");
    const Route = asRouteStub(routeModule.Route);

    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    const view = render(<Component />);
    const props = JSON.parse(view.getByTestId("sign-in-page").dataset.props ?? "{}") as {
      errorCode?: string;
      initialEmail?: string;
      invitationId?: string;
      redirectTo?: string;
    };
    expect(props.errorCode).toBe("missing_provider");
    expect(props).not.toHaveProperty("existingAccount");
    expect(props.initialEmail).toBe("ops@acme.test");
    expect(props.invitationId).toBe("inv_1");
    expect(props.redirectTo).toBe("/discovery");
  });
});
