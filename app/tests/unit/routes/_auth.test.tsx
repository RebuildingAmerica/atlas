// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/platform/layout/auth-layout", () => ({
  AuthFlowLayout: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="auth-layout">{children}</div>
  ),
}));

describe("routes/_auth layout", () => {
  afterEach(() => {
    cleanup();
  });

  it("wraps the auth outlet in AuthFlowLayout", async () => {
    const routeModule = await import("@/routes/_auth");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);

    expect(screen.getByTestId("auth-layout")).toBeInTheDocument();
    expect(screen.getByTestId("router-outlet")).toBeInTheDocument();
  });

  it("keeps auth pages out of search indexes", async () => {
    const routeModule = await import("@/routes/_auth");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    expect(Route.options.head?.({})).toEqual({
      meta: [
        { title: "Atlas account" },
        { name: "description", content: "Access your Atlas account." },
        { name: "robots", content: "noindex,nofollow" },
      ],
    });
  });
});
