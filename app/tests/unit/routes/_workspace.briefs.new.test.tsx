// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/workspace/pages/brief-create-page", () => ({
  BriefCreatePage: () => <div data-testid="brief-create" />,
}));

describe("routes/_workspace/briefs/new", () => {
  beforeEach(async () => {
    const { resetRouterMocks } = await import("@/../tests/helpers/router-harness");
    resetRouterMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the brief creation page", async () => {
    const routeModule = await import("@/routes/_workspace/briefs.new");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);

    expect(screen.getByTestId("brief-create")).toBeInTheDocument();
  });

  it("sets a document title for manual brief creation", async () => {
    const routeModule = await import("@/routes/_workspace/briefs.new");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    expect(Route.options.head?.({})).toEqual({
      meta: [{ title: "New Atlas Brief | Atlas" }],
    });
  });
});
