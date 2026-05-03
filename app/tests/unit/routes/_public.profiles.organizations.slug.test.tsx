// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/catalog/pages/profiles/detail/org-profile-page", () => ({
  OrgProfilePage: ({ entry }: { entry: { name?: string } }) => (
    <div data-testid="org-profile" data-name={entry.name ?? ""} />
  ),
}));

vi.mock("@/domains/catalog/server/profiles/profile-loaders", () => ({
  loadProfileBySlug: vi.fn(),
}));

describe("routes/_public/profiles/organizations/$slug", () => {
  beforeEach(async () => {
    const { resetRouterMocks } = await import("@/../tests/helpers/router-harness");
    resetRouterMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("loads the organization by slug and exposes canonical SEO meta", async () => {
    const { loadProfileBySlug } = await import("@/domains/catalog/server/profiles/profile-loaders");
    const entry = {
      name: "Acme",
      slug: "acme",
      description: "An organization that does things.".repeat(10),
    };
    vi.mocked(loadProfileBySlug).mockResolvedValue(
      entry as Awaited<ReturnType<typeof loadProfileBySlug>>,
    );

    const routeModule = await import("@/routes/_public/profiles/organizations.$slug");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    if (!Route.options.loader) throw new Error("Expected loader");
    const loaded = await Route.options.loader({ params: { slug: "acme" } } as never);
    expect(loadProfileBySlug).toHaveBeenCalledWith({
      data: { type: "organizations", slug: "acme" },
    });
    expect(loaded).toEqual({ entry });

    if (!Route.options.head) throw new Error("Expected head");
    const headPayload = Route.options.head({ loaderData: { entry } } as never) as {
      meta: Record<string, string>[];
      links: Record<string, string>[];
    };
    expect(headPayload.meta).toEqual(
      expect.arrayContaining([{ title: "Acme — Organization | Atlas" }]),
    );
    expect(headPayload.links[0]).toEqual({
      rel: "canonical",
      href: "https://atlas.rebuildingamerica.com/profiles/organizations/acme",
    });
  });

  it("returns an empty head payload when loaderData is missing the entry", async () => {
    const routeModule = await import("@/routes/_public/profiles/organizations.$slug");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    if (!Route.options.head) throw new Error("Expected head");
    expect(Route.options.head({ loaderData: undefined } as never)).toEqual({});
    expect(Route.options.head({ loaderData: {} } as never)).toEqual({});
  });

  it("uses an empty description fallback when the entry omits one", async () => {
    const routeModule = await import("@/routes/_public/profiles/organizations.$slug");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    const entry = { name: "Acme", slug: "acme", description: null };
    if (!Route.options.head) throw new Error("Expected head");
    const headPayload = Route.options.head({ loaderData: { entry } } as never) as {
      meta: Record<string, string>[];
    };
    expect(headPayload.meta).toEqual(
      expect.arrayContaining([{ name: "description", content: "" }]),
    );
  });

  it("renders OrgProfilePage with the loader entry", async () => {
    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    const router = readRouterMocks();
    router.useLoaderData.mockReturnValue({ entry: { name: "Acme" } });

    const routeModule = await import("@/routes/_public/profiles/organizations.$slug");
    const Route = asRouteStub(routeModule.Route);

    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    const view = render(<Component />);
    expect(view.getByTestId("org-profile").dataset.name).toBe("Acme");
  });
});
