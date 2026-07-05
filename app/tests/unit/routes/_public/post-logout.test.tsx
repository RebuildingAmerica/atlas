// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

describe("routes/_public/post-logout", () => {
  afterEach(() => {
    cleanup();
  });

  it("disables SSR and renders the signed-out confirmation copy", async () => {
    const routeModule = await import("@/routes/_public/post-logout");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    expect(Route.options.ssr).toBe(false);

    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);
    expect(screen.getByText(/You have signed out of Atlas/i)).toBeInTheDocument();
    expect(screen.getByText(/Back to Atlas/)).toBeInTheDocument();
  });
});
