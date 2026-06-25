// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

describe("routes/_workspace/home", () => {
  afterEach(() => {
    cleanup();
  });

  it("sets the My Research head title", async () => {
    const routeModule = await import("@/routes/_workspace/home");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    if (!Route.options.head) throw new Error("Expected head");
    const head = Route.options.head() as { meta: { title: string }[] };
    expect(head.meta).toContainEqual({ title: "My Research | Atlas" });
  });

  it("renders the research-base placeholder copy", async () => {
    const routeModule = await import("@/routes/_workspace/home");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);
    expect(screen.getByRole("heading", { name: /Your research base/ })).toBeInTheDocument();
  });
});
