// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/catalog/hooks/use-claims", () => ({
  useFollowingFeed: vi.fn(),
}));

vi.mock("@/platform/ui/badge", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

describe("routes/_workspace/feed", () => {
  beforeEach(async () => {
    const { resetRouterMocks } = await import("@/../tests/helpers/router-harness");
    resetRouterMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows the loading copy while the feed query is in flight", async () => {
    const claims = await import("@/domains/catalog/hooks/use-claims");
    vi.mocked(claims.useFollowingFeed).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as unknown as ReturnType<typeof claims.useFollowingFeed>);

    const routeModule = await import("@/routes/_workspace/feed");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);
    expect(screen.getByText(/Loading feed…/)).toBeInTheDocument();
  });

  it("shows the empty state when the feed has no items", async () => {
    const claims = await import("@/domains/catalog/hooks/use-claims");
    vi.mocked(claims.useFollowingFeed).mockReturnValue({
      data: { items: [] },
      isLoading: false,
    } as unknown as ReturnType<typeof claims.useFollowingFeed>);

    const routeModule = await import("@/routes/_workspace/feed");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);
    expect(screen.getByText("Nothing here yet.")).toBeInTheDocument();
  });

  it("renders feed items and handles entries with and without slugs and publication", async () => {
    const claims = await import("@/domains/catalog/hooks/use-claims");
    vi.mocked(claims.useFollowingFeed).mockReturnValue({
      data: {
        items: [
          {
            entry_id: "e1",
            entry_name: "Acme",
            entry_slug: "acme",
            entry_type: "organization",
            source_id: "s1",
            source_url: "https://acme.test/news",
            source_title: "Big news",
            source_publication: "Acme Times",
            ingested_at: "2024-04-01T00:00:00Z",
          },
          {
            entry_id: "e2",
            entry_name: "Jane",
            entry_slug: undefined,
            entry_type: "person",
            source_id: "s2",
            source_url: "https://jane.test/post",
            source_title: undefined,
            source_publication: undefined,
            ingested_at: "2024-04-02T00:00:00Z",
          },
        ],
      },
      isLoading: false,
    } as unknown as ReturnType<typeof claims.useFollowingFeed>);

    const routeModule = await import("@/routes/_workspace/feed");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);
    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.getByText("Big news")).toBeInTheDocument();
    expect(screen.getByText(/Acme Times/)).toBeInTheDocument();
    expect(screen.getByText("Jane")).toBeInTheDocument();
    expect(screen.getByText("https://jane.test/post")).toBeInTheDocument();
  });

  it("falls back to an empty items list when the feed query has no data shape", async () => {
    const claims = await import("@/domains/catalog/hooks/use-claims");
    vi.mocked(claims.useFollowingFeed).mockReturnValue({
      data: undefined,
      isLoading: false,
    } as unknown as ReturnType<typeof claims.useFollowingFeed>);

    const routeModule = await import("@/routes/_workspace/feed");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);
    expect(screen.getByText("Nothing here yet.")).toBeInTheDocument();
  });
});
