// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/catalog/pages/profiles/overview/profiles-overview-page", () => ({
  ProfilesOverviewPage: ({
    scope,
    initialCatalog,
  }: {
    scope?: string;
    initialCatalog?: unknown;
  }) => (
    <div
      data-testid="profiles-overview-page"
      data-scope={scope ?? ""}
      data-catalog={JSON.stringify(initialCatalog)}
    />
  ),
}));

vi.mock("@/domains/catalog/server/profiles/profile-loaders", () => ({
  loadProfilesCatalog: vi.fn(),
}));

describe("routes/_public/profiles/index", () => {
  beforeEach(async () => {
    const { resetRouterMocks } = await import("@/../tests/helpers/router-harness");
    resetRouterMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("loads the all-profiles catalog and exposes meta tags", async () => {
    const { loadProfilesCatalog } =
      await import("@/domains/catalog/server/profiles/profile-loaders");
    const catalog = { items: ["a"] };
    vi.mocked(loadProfilesCatalog).mockResolvedValue(
      catalog as unknown as Awaited<ReturnType<typeof loadProfilesCatalog>>,
    );

    const routeModule = await import("@/routes/_public/profiles/index");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    if (!Route.options.loader) throw new Error("Expected loader");
    const data = await Route.options.loader();
    expect(loadProfilesCatalog).toHaveBeenCalledWith({ data: { scope: "all" } });
    expect(data).toEqual({ catalog });

    if (!Route.options.head) throw new Error("Expected head");
    const headPayload = Route.options.head({}) as { meta: Record<string, string>[] };
    expect(headPayload.meta[0]).toEqual({ title: "Profiles | Atlas" });
  });

  it("renders ProfilesOverviewPage with the loader catalog", async () => {
    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    const router = readRouterMocks();
    router.useLoaderData.mockReturnValue({ catalog: { items: ["x"] } });

    const routeModule = await import("@/routes/_public/profiles/index");
    const Route = asRouteStub(routeModule.Route);

    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    const view = render(<Component />);
    expect(view.getByTestId("profiles-overview-page").dataset.catalog).toBe(
      JSON.stringify({ items: ["x"] }),
    );
  });
});
