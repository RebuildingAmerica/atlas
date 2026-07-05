// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/catalog/pages/profiles/overview/profiles-overview-page", () => ({
  ProfilesOverviewPage: ({ scope }: { scope?: string }) => (
    <div data-testid="profiles-overview-page" data-scope={scope ?? ""} />
  ),
}));

vi.mock("@/domains/catalog/server/profiles/profile-loaders", () => ({
  loadProfilesCatalog: vi.fn(),
}));

describe("routes/_public/profiles/organizations/index", () => {
  beforeEach(async () => {
    const { resetRouterMocks } = await import("@/../tests/helpers/router-harness");
    resetRouterMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("loads the organizations-scoped catalog and exposes the right meta tags", async () => {
    const { loadProfilesCatalog } =
      await import("@/domains/catalog/server/profiles/profile-loaders");
    vi.mocked(loadProfilesCatalog).mockResolvedValue({ ok: true } as unknown as Awaited<
      ReturnType<typeof loadProfilesCatalog>
    >);

    const routeModule = await import("@/routes/_public/profiles/organizations/index");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    if (!Route.options.loader) throw new Error("Expected loader");
    await Route.options.loader();
    expect(loadProfilesCatalog).toHaveBeenCalledWith({ data: { scope: "organizations" } });

    if (!Route.options.head) throw new Error("Expected head");
    const headPayload = Route.options.head({}) as { meta: Record<string, string>[] };
    expect(headPayload.meta[0]).toEqual({ title: "Organization Profiles | Atlas" });
  });

  it("renders ProfilesOverviewPage with the organizations scope", async () => {
    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    const router = readRouterMocks();
    router.useLoaderData.mockReturnValue({ catalog: { items: [] } });

    const routeModule = await import("@/routes/_public/profiles/organizations/index");
    const Route = asRouteStub(routeModule.Route);

    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    const view = render(<Component />);
    expect(view.getByTestId("profiles-overview-page").dataset.scope).toBe("organizations");
  });
});
