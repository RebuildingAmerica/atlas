// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/access/pages/auth/accept-invitation-page", () => ({
  AcceptInvitationPage: (props: Record<string, unknown>) => (
    <div data-testid="accept-invitation-page" data-props={JSON.stringify(props)} />
  ),
}));

vi.mock("@/domains/access/server", () => ({
  redirectIfLocalSession: vi.fn(),
}));

describe("routes/_auth/accept-invitation.$invitationId", () => {
  beforeEach(async () => {
    const { resetRouterMocks } = await import("@/../tests/helpers/router-harness");
    resetRouterMocks();
    const access = await import("@/domains/access/server");
    vi.mocked(access.redirectIfLocalSession).mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("validates a redirect-only search schema and redirects local sessions", async () => {
    const routeModule = await import("@/routes/_auth/accept-invitation.$invitationId");
    const access = await import("@/domains/access/server");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    const validator = Route.options.validateSearch as { parse: (input: unknown) => unknown };
    expect(validator.parse({ redirect: "/organization" })).toEqual({ redirect: "/organization" });
    expect(validator.parse({})).toEqual({});

    if (!Route.options.beforeLoad) throw new Error("Expected beforeLoad");
    Route.options.beforeLoad({});
    expect(access.redirectIfLocalSession).toHaveBeenCalledWith("/discovery");
  });

  it("forwards the route invitationId param into AcceptInvitationPage", async () => {
    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    const router = readRouterMocks();
    router.useParams.mockReturnValue({ invitationId: "inv_42" });

    const routeModule = await import("@/routes/_auth/accept-invitation.$invitationId");
    const Route = asRouteStub(routeModule.Route);

    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    const view = render(<Component />);
    const props = JSON.parse(view.getByTestId("accept-invitation-page").dataset.props ?? "{}") as {
      invitationId?: string;
    };
    expect(props.invitationId).toBe("inv_42");
  });
});
