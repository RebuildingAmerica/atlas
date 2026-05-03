// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@openstatus/react", () => ({
  getStatus: vi.fn(),
}));

vi.mock("@/domains/access/session.functions", () => ({
  getAtlasDeployMode: vi.fn(),
}));

vi.mock("@/platform/layout/public-nav", () => ({
  PublicTopNav: ({ localMode }: { localMode: boolean }) => (
    <div data-testid="public-top-nav" data-local-mode={String(localMode)} />
  ),
}));

vi.mock("@/platform/layout/public-footer", () => ({
  PublicFooter: ({ localMode, status }: { localMode: boolean; status: string }) => (
    <div data-testid="public-footer" data-local-mode={String(localMode)} data-status={status} />
  ),
}));

describe("routes/_public layout", () => {
  beforeEach(async () => {
    const { resetRouterMocks } = await import("@/../tests/helpers/router-harness");
    resetRouterMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("loads deploy mode and the OpenStatus result in parallel", async () => {
    const { getAtlasDeployMode } = await import("@/domains/access/session.functions");
    const openstatus = await import("@openstatus/react");
    vi.mocked(getAtlasDeployMode).mockResolvedValue({
      localMode: true,
    } as Awaited<ReturnType<typeof getAtlasDeployMode>>);
    vi.mocked(openstatus.getStatus).mockResolvedValue({
      status: "operational",
    } as Awaited<ReturnType<typeof openstatus.getStatus>>);

    const routeModule = await import("@/routes/_public");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    if (!Route.options.loader) throw new Error("Expected loader");
    const data = await Route.options.loader();
    expect(getAtlasDeployMode).toHaveBeenCalled();
    expect(openstatus.getStatus).toHaveBeenCalledWith("atlasapp");
    expect(data).toEqual({ localMode: true, status: "operational" });
    expect(Route.options.staleTime).toBe(1000 * 60 * 5);
  });

  it("falls back to 'unknown' when the OpenStatus probe rejects", async () => {
    const { getAtlasDeployMode } = await import("@/domains/access/session.functions");
    const openstatus = await import("@openstatus/react");
    vi.mocked(getAtlasDeployMode).mockResolvedValue({
      localMode: false,
    } as Awaited<ReturnType<typeof getAtlasDeployMode>>);
    vi.mocked(openstatus.getStatus).mockRejectedValue(new Error("probe failed"));

    const routeModule = await import("@/routes/_public");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    if (!Route.options.loader) throw new Error("Expected loader");
    const data = await Route.options.loader();
    expect(data).toEqual({ localMode: false, status: "unknown" });
  });

  it("renders the top nav, outlet, and footer with the loader payload", async () => {
    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    const router = readRouterMocks();
    router.useLoaderData.mockReturnValue({ localMode: true, status: "operational" });

    const routeModule = await import("@/routes/_public");
    const Route = asRouteStub(routeModule.Route);
    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);
    expect(screen.getByTestId("public-top-nav").dataset.localMode).toBe("true");
    expect(screen.getByTestId("router-outlet")).toBeInTheDocument();
    expect(screen.getByTestId("public-footer").dataset.status).toBe("operational");
  });
});
