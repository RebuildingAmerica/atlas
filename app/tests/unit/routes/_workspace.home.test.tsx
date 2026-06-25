// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResearchSummary } from "@/domains/workspace/server/research-summary";

const mocks = vi.hoisted(() => ({
  loadResearchSummary: vi.fn(),
}));

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/workspace/server/research-summary", () => ({
  loadResearchSummary: mocks.loadResearchSummary,
}));

vi.mock("@/domains/workspace/pages/research-home-page", () => ({
  ResearchHomePage: ({ initialSummary }: { initialSummary: ResearchSummary }) => (
    <div data-testid="research-home" data-list-count={initialSummary.totals.listCount} />
  ),
}));

describe("routes/_workspace/home", () => {
  function summary(): ResearchSummary {
    return {
      lists: [],
      activity: { newSourcesThisWeek: 0, recentItems: [], followedActorCount: 0 },
      recentRuns: [],
      totals: { savedActors: 0, listCount: 3, runsThisMonth: 0 },
    };
  }

  beforeEach(async () => {
    const { resetRouterMocks } = await import("@/../tests/helpers/router-harness");
    resetRouterMocks();
    mocks.loadResearchSummary.mockReset();
  });

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

  it("loads the research summary through the server function", async () => {
    mocks.loadResearchSummary.mockResolvedValue(summary());

    const routeModule = await import("@/routes/_workspace/home");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    if (!Route.options.loader) throw new Error("Expected loader");
    const data = (await Route.options.loader()) as { summary: ResearchSummary };
    expect(mocks.loadResearchSummary).toHaveBeenCalledTimes(1);
    expect(data.summary.totals.listCount).toBe(3);
  });

  it("renders the research home page seeded with the loader summary", async () => {
    const routeModule = await import("@/routes/_workspace/home");
    const { asRouteStub, readRouterMocks } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    readRouterMocks().useLoaderData.mockReturnValue({ summary: summary() });

    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);
    expect(screen.getByTestId("research-home")).toHaveAttribute("data-list-count", "3");
  });
});
