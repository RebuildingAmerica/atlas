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
  const NOW = new Date("2026-06-25T12:00:00Z");

  beforeEach(async () => {
    const { resetRouterMocks } = await import("@/../tests/helpers/router-harness");
    resetRouterMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
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
    expect(screen.getByText("Loading")).toBeInTheDocument();
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
    expect(screen.getByText("No followed-profile updates.")).toBeInTheDocument();
  });

  it("renders a monitoring digest before feed items", async () => {
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
            ingested_at: "2026-06-24T00:00:00Z",
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
            ingested_at: "2026-06-20T00:00:00Z",
          },
          {
            entry_id: "e1",
            entry_name: "Acme",
            entry_slug: "acme",
            entry_type: "organization",
            source_id: "s3",
            source_url: "https://acme.test/older",
            source_title: "Older update",
            source_publication: undefined,
            ingested_at: "2026-05-01T00:00:00Z",
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
    expect(screen.getByRole("heading", { name: "Monitoring digest" })).toBeInTheDocument();
    expect(screen.getByText("3 source signals")).toBeInTheDocument();
    expect(screen.getByText("2 followed actors")).toBeInTheDocument();
    expect(screen.getByText("2 this week")).toBeInTheDocument();
    expect(screen.queryByText(/newest first/i)).not.toBeInTheDocument();
    expect(screen.getAllByText("Acme")).toHaveLength(2);
    expect(screen.getByText("Big news")).toBeInTheDocument();
    expect(screen.getByText(/Acme Times/)).toBeInTheDocument();
    expect(screen.getByText("Jane")).toBeInTheDocument();
    expect(screen.getByText("https://jane.test/post")).toBeInTheDocument();
  });

  it("classifies feed changes by attention and freshness", async () => {
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
            source_title: "First Acme story",
            source_publication: "Acme Times",
            ingested_at: "2026-06-24T00:00:00Z",
          },
          {
            entry_id: "e1",
            entry_name: "Acme",
            entry_slug: "acme",
            entry_type: "organization",
            source_id: "s2",
            source_url: "https://acme.test/follow-up",
            source_title: "Second Acme story",
            source_publication: "Acme Times",
            ingested_at: "2026-06-23T00:00:00Z",
          },
          {
            entry_id: "e2",
            entry_name: "Jane",
            entry_slug: "jane",
            entry_type: "person",
            source_id: "s3",
            source_url: "https://jane.test/recent",
            source_title: "Jane update",
            source_publication: undefined,
            ingested_at: "2026-06-22T00:00:00Z",
          },
          {
            entry_id: "e3",
            entry_name: "Older Org",
            entry_slug: "older-org",
            entry_type: "organization",
            source_id: "s4",
            source_url: "https://older.test/archive",
            source_title: "Archived mention",
            source_publication: undefined,
            ingested_at: "2026-05-01T00:00:00Z",
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
    expect(screen.getByRole("region", { name: "Change classification" })).toBeInTheDocument();
    expect(screen.getByText("Source attention shift")).toBeInTheDocument();
    expect(screen.getByText("Acme appeared in 2 new sources.")).toBeInTheDocument();
    expect(screen.getByText("Recent source signal")).toBeInTheDocument();
    expect(screen.getByText("Jane has a new source this week.")).toBeInTheDocument();
    expect(screen.getByText("Freshness review")).toBeInTheDocument();
    expect(screen.getByText("Older Org has no source signal this month.")).toBeInTheDocument();
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
    expect(screen.getByText("No followed-profile updates.")).toBeInTheDocument();
  });
});
