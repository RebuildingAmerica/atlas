// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/discovery", () => ({
  DiscoveryPage: vi.fn(() => null),
}));

vi.mock("@/domains/discovery/hooks/use-discovery", () => ({
  discoveryRunsQueryOptions: vi.fn(() => ({ queryKey: ["discovery", "runs"] })),
}));

vi.mock("@rebuildingamerica/atlas-catalog/hooks/use-taxonomy", () => ({
  taxonomyQueryOptions: vi.fn(() => ({ queryKey: ["taxonomy"] })),
}));

describe("routes/_workspace/discovery", () => {
  afterEach(() => {
    cleanup();
  });

  it("registers an SSR-friendly route with metadata", async () => {
    const routeModule = await import("@/routes/_workspace/discovery");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    expect(Route.options.component).toBeDefined();
    expect(Route.options.ssr).not.toBe(false);
    expect(Route.options.head?.({})).toEqual({
      meta: [
        {
          title: "Research | Atlas",
        },
        {
          name: "description",
          content: "Start source-linked local civic research and export reusable briefs.",
        },
      ],
    });
  });

  it("validates coverage-gap search params for research prefill", async () => {
    const routeModule = await import("@/routes/_workspace/discovery");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    const validator = Route.options.validateSearch as { parse: (input: unknown) => unknown };
    expect(
      validator.parse({
        issue_areas: "housing_affordability",
        location: "Kansas City, MO",
        research_goal: "partner_scan",
        run: "run_123",
        state: "mo",
      }),
    ).toEqual({
      issue_areas: "housing_affordability",
      location: "Kansas City, MO",
      research_goal: "partner_scan",
      run: "run_123",
      state: "mo",
    });
    expect(validator.parse({ research_goal: "not_a_goal" })).toEqual({});
  });

  it("preloads discovery runs and taxonomy into the router query cache", async () => {
    const discoveryHooks = await import("@/domains/discovery/hooks/use-discovery");
    const taxonomyHooks = await import("@rebuildingamerica/atlas-catalog/hooks/use-taxonomy");
    const ensureQueryData = vi
      .fn()
      .mockResolvedValueOnce({ items: [], total: 0 })
      .mockResolvedValueOnce({
        Housing: [
          { name: "Housing affordability", slug: "housing_affordability", description: "" },
        ],
      });

    const routeModule = await import("@/routes/_workspace/discovery");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    if (!Route.options.loader) throw new Error("Expected loader");
    await expect(
      Route.options.loader({ context: { queryClient: { ensureQueryData } } }),
    ).resolves.toBeUndefined();
    expect(discoveryHooks.discoveryRunsQueryOptions).toHaveBeenCalledWith();
    expect(taxonomyHooks.taxonomyQueryOptions).toHaveBeenCalledWith();
    expect(ensureQueryData).toHaveBeenCalledWith({ queryKey: ["discovery", "runs"] });
    expect(ensureQueryData).toHaveBeenCalledWith({ queryKey: ["taxonomy"] });
  });

  it("passes validated search params into the discovery page", async () => {
    const discovery = await import("@/domains/discovery");
    const routeModule = await import("@/routes/_workspace/discovery");
    const { asRouteStub, readRouterMocks } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    readRouterMocks().useSearch.mockReturnValue({
      issue_areas: "housing_affordability",
      location: "Kansas City, MO",
      research_goal: "partner_scan",
      run: "run_123",
      state: "MO",
    });

    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);

    expect(vi.mocked(discovery.DiscoveryPage)).toHaveBeenCalledWith(
      {
        initialRequest: {
          issue_areas: "housing_affordability",
          location: "Kansas City, MO",
          research_goal: "partner_scan",
          state: "MO",
        },
        selectedRunId: "run_123",
      },
      undefined,
    );
  });
});
