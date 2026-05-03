// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

describe("routes/dashboard", () => {
  afterEach(() => {
    cleanup();
  });

  it("disables SSR and renders the placeholder dashboard copy", async () => {
    const routeModule = await import("@/routes/dashboard");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    expect(Route.options.ssr).toBe(false);
    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);
    expect(screen.getByRole("heading", { name: /Dashboard/ })).toBeInTheDocument();
    expect(screen.getByText(/Dashboard implementation pending/)).toBeInTheDocument();
  });
});
