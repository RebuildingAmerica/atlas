// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  asRouteStub,
  readRouterMocks,
  resetRouterMocks,
  routerPathnameState,
} from "@/../tests/helpers/router-harness";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@openstatus/react", () => ({
  getStatus: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn(),
}));

vi.mock("@/domains/access/session.functions", () => ({
  getAtlasDeployMode: vi.fn(),
}));

vi.mock("@/platform/layout/public-nav", () => ({
  PublicTopNav: ({ localMode, showSearch }: { localMode: boolean; showSearch: boolean }) => (
    <div
      data-testid="public-top-nav"
      data-local-mode={String(localMode)}
      data-show-search={String(showSearch)}
    />
  ),
}));

vi.mock("@/platform/layout/public-footer", () => ({
  PublicFooter: ({ localMode }: { localMode: boolean }) => (
    <div data-testid="public-footer" data-local-mode={String(localMode)} />
  ),
}));

describe("routes/_public layout", () => {
  beforeEach(async () => {
    resetRouterMocks();
    const { useQuery } = await import("@tanstack/react-query");
    vi.mocked(useQuery).mockReturnValue({
      data: { localMode: false },
    } as unknown as ReturnType<typeof useQuery>);
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the top nav, outlet, and footer with resolved deploy mode", async () => {
    const router = readRouterMocks();
    const { useQuery } = await import("@tanstack/react-query");
    vi.mocked(useQuery).mockReturnValue({
      data: { localMode: true },
    } as unknown as ReturnType<typeof useQuery>);
    router.useRouterState.mockImplementation(routerPathnameState("/pricing"));

    const routeModule = await import("@/routes/_public");
    const Route = asRouteStub(routeModule.Route);
    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    const { container } = render(<Component />);
    expect(container.firstElementChild).toHaveClass("atlas-public-shell");
    expect(screen.getByTestId("public-global-grid")).toBeInTheDocument();
    expect(screen.getByTestId("public-sticky-nav-boundary")).toContainElement(
      screen.getByTestId("public-top-nav"),
    );
    expect(screen.getByTestId("public-sticky-nav-boundary")).toContainElement(
      screen.getByTestId("router-outlet"),
    );
    expect(screen.getByTestId("public-sticky-nav-boundary")).not.toContainElement(
      screen.getByTestId("public-footer"),
    );
    expect(screen.getByTestId("public-top-nav").dataset.localMode).toBe("true");
    expect(screen.getByTestId("public-top-nav").dataset.showSearch).toBe("true");
    expect(screen.getByTestId("router-outlet")).toBeInTheDocument();
    expect(screen.getByTestId("public-footer").dataset.localMode).toBe("true");
  });

  it("renders the public shell while deploy mode is unavailable", async () => {
    const router = readRouterMocks();
    const { useQuery } = await import("@tanstack/react-query");
    vi.mocked(useQuery).mockReturnValue({
      data: undefined,
      isError: true,
    } as unknown as ReturnType<typeof useQuery>);
    router.useLoaderData.mockReturnValue(undefined);
    router.useRouterState.mockImplementation(routerPathnameState("/pricing"));

    const routeModule = await import("@/routes/_public");
    const Route = asRouteStub(routeModule.Route);
    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");

    render(<Component />);

    expect(screen.getByTestId("public-top-nav")).toBeInTheDocument();
    expect(screen.getByTestId("router-outlet")).toBeInTheDocument();
    expect(screen.getByTestId("public-footer")).toBeInTheDocument();
    expect(screen.getByTestId("public-top-nav").dataset.localMode).toBe("false");
    expect(screen.getByTestId("public-footer").dataset.localMode).toBe("false");
  });

  it("lets the map own the full viewport without the public footer", async () => {
    const router = readRouterMocks();
    router.useLoaderData.mockReturnValue({ localMode: false });
    router.useRouterState.mockImplementation(routerPathnameState("/map"));

    const routeModule = await import("@/routes/_public");
    const Route = asRouteStub(routeModule.Route);
    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    const { container } = render(<Component />);

    expect(screen.getByTestId("public-top-nav").dataset.showSearch).toBe("true");
    expect(screen.getByTestId("router-outlet")).toBeInTheDocument();
    expect(screen.queryByTestId("public-footer")).toBeNull();
    expect(container.firstElementChild).toHaveClass("h-dvh", "overflow-hidden");
    expect(container.querySelector("main")).toHaveClass("min-h-0", "overflow-hidden");
  });

  it("lets the public home page own search", async () => {
    const router = readRouterMocks();
    router.useLoaderData.mockReturnValue({ localMode: false });
    router.useRouterState.mockImplementation(routerPathnameState("/"));

    const routeModule = await import("@/routes/_public");
    const Route = asRouteStub(routeModule.Route);
    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);

    expect(screen.getByTestId("public-top-nav").dataset.showSearch).toBe("false");
  });
});
