// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  researchSummaryQueryOptions: vi.fn(),
}));

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/workspace/hooks/use-research-summary", () => ({
  researchSummaryQueryOptions: mocks.researchSummaryQueryOptions,
}));

vi.mock("@/domains/workspace/pages/research-home-page", () => ({
  ResearchHomePage: () => <div data-testid="research-home" />,
}));

describe("routes/_workspace/home", () => {
  beforeEach(async () => {
    const { resetRouterMocks } = await import("@/../tests/helpers/router-harness");
    resetRouterMocks();
    mocks.researchSummaryQueryOptions.mockReset();
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

  it("seeds the research summary query through the router context", async () => {
    const queryOptions = { queryKey: ["workspace", "research-summary"] };
    const ensureQueryData = vi.fn().mockResolvedValue({ totals: { listCount: 3 } });
    mocks.researchSummaryQueryOptions.mockReturnValue(queryOptions);

    const routeModule = await import("@/routes/_workspace/home");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    if (!Route.options.loader) throw new Error("Expected loader");
    const data = await Route.options.loader({ context: { queryClient: { ensureQueryData } } });

    expect(mocks.researchSummaryQueryOptions).toHaveBeenCalledWith();
    expect(ensureQueryData).toHaveBeenCalledWith(queryOptions);
    expect(data).toBeUndefined();
  });

  it("renders the research home page", async () => {
    const routeModule = await import("@/routes/_workspace/home");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);
    expect(screen.getByTestId("research-home")).toBeInTheDocument();
  });
});
