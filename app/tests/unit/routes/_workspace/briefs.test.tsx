// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  workspaceBriefsQueryOptions: vi.fn(),
}));

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/workspace/hooks/use-briefs", () => ({
  workspaceBriefsQueryOptions: mocks.workspaceBriefsQueryOptions,
}));

vi.mock("@/domains/workspace/pages/brief-list-page", () => ({
  BriefListPage: () => <div data-testid="brief-list" />,
}));

describe("routes/_workspace/briefs", () => {
  beforeEach(async () => {
    const { resetRouterMocks } = await import("@/../tests/helpers/router-harness");
    resetRouterMocks();
    mocks.workspaceBriefsQueryOptions.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("seeds workspace briefs through the router context", async () => {
    const data = { items: [], total: 0 };
    const queryOptions = { queryKey: ["workspace", "briefs", "list"] };
    const ensureQueryData = vi.fn().mockResolvedValue(data);
    mocks.workspaceBriefsQueryOptions.mockReturnValue(queryOptions);

    const routeModule = await import("@/routes/_workspace/briefs");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    if (!Route.options.loader) throw new Error("Expected loader");
    const result = await Route.options.loader({ context: { queryClient: { ensureQueryData } } });

    expect(result).toBe(data);
    expect(mocks.workspaceBriefsQueryOptions).toHaveBeenCalledWith();
    expect(ensureQueryData).toHaveBeenCalledWith(queryOptions);
  });

  it("sets the workspace briefs page title", async () => {
    const routeModule = await import("@/routes/_workspace/briefs");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    expect(Route.options.head?.({})).toEqual({
      meta: [{ title: "Atlas Briefs | Atlas" }],
    });
  });

  it("renders the brief list page", async () => {
    const routeModule = await import("@/routes/_workspace/briefs");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);

    expect(screen.getByTestId("brief-list")).toBeInTheDocument();
  });
});
