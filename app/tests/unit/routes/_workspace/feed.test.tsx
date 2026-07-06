// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { useWorkspaceWatchDigest } from "@/domains/workspace/hooks/use-workspace-watch-digest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/workspace/hooks/use-workspace-watch-digest", () => ({
  useWorkspaceWatchDigest: vi.fn(),
}));

vi.mock("@/platform/ui/badge", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

describe("routes/_workspace/feed", () => {
  type WorkspaceWatchDigestQuery = ReturnType<typeof useWorkspaceWatchDigest>;

  function watchDigestQuery(
    query: Pick<WorkspaceWatchDigestQuery, "data" | "isLoading">,
  ): WorkspaceWatchDigestQuery {
    return query as WorkspaceWatchDigestQuery;
  }

  beforeEach(async () => {
    const { resetRouterMocks } = await import("@/../tests/helpers/router-harness");
    resetRouterMocks();
  });

  afterEach(() => {
    cleanup();
  });

  async function renderRoute() {
    const routeModule = await import("@/routes/_workspace/feed");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);
  }

  it("shows the loading copy while the workspace digest query is in flight", async () => {
    const digest = await import("@/domains/workspace/hooks/use-workspace-watch-digest");
    vi.mocked(digest.useWorkspaceWatchDigest).mockReturnValue(
      watchDigestQuery({
        data: undefined,
        isLoading: true,
      }),
    );

    await renderRoute();

    expect(screen.getByText("Loading")).toBeInTheDocument();
  });

  it("shows the empty state when the workspace digest has no items", async () => {
    const digest = await import("@/domains/workspace/hooks/use-workspace-watch-digest");
    vi.mocked(digest.useWorkspaceWatchDigest).mockReturnValue(
      watchDigestQuery({
        data: {
          coverage_signal_count: 0,
          items: [],
          source_signal_count: 0,
          total: 0,
        },
        isLoading: false,
      }),
    );

    await renderRoute();

    expect(screen.getByText("No watch updates.")).toBeInTheDocument();
  });

  it("renders workspace digest summary and source-backed watch events", async () => {
    const digest = await import("@/domains/workspace/hooks/use-workspace-watch-digest");
    vi.mocked(digest.useWorkspaceWatchDigest).mockReturnValue(
      watchDigestQuery({
        data: {
          coverage_signal_count: 0,
          items: [
            {
              created_at: "2026-06-24T00:00:00Z",
              entry: {
                id: "entry_123",
                name: "KC Tenants",
                slug: "kc-tenants",
                type: "organization",
              },
              event_type: "new_source",
              id: "event_123",
              resource_id: "entry_123",
              resource_type: "entry",
              source: {
                id: "source_123",
                publication: "Example Civic News",
                published_date: null,
                title: "Tenant update",
                type: "community_archive",
                url: "https://example.test/kc-tenants",
              },
              summary: "Tenant meeting coverage.",
              title: "New source for KC Tenants",
            },
          ],
          source_signal_count: 1,
          total: 1,
        },
        isLoading: false,
      }),
    );

    await renderRoute();

    expect(screen.getByRole("heading", { name: "Monitoring digest" })).toBeInTheDocument();
    expect(screen.getByText("1 watch update")).toBeInTheDocument();
    expect(screen.getByText("1 source signal")).toBeInTheDocument();
    expect(screen.getByText("0 coverage changes")).toBeInTheDocument();
    expect(screen.getByText("New source for KC Tenants")).toBeInTheDocument();
    expect(screen.getByText("Tenant meeting coverage.")).toBeInTheDocument();
    expect(screen.getByText("KC Tenants")).toBeInTheDocument();
    expect(screen.getByText("Tenant update")).toBeInTheDocument();
    expect(screen.getByText(/Example Civic News/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open source" })).toHaveAttribute(
      "href",
      "https://example.test/kc-tenants",
    );
  });

  it("renders coverage status changes without source context", async () => {
    const digest = await import("@/domains/workspace/hooks/use-workspace-watch-digest");
    vi.mocked(digest.useWorkspaceWatchDigest).mockReturnValue(
      watchDigestQuery({
        data: {
          coverage_signal_count: 1,
          items: [
            {
              created_at: "2026-06-25T00:00:00Z",
              entry: null,
              event_type: "coverage_status_changed",
              id: "event_coverage_123",
              resource_id: "coverage_123",
              resource_type: "coverage_target",
              source: null,
              summary: "Coverage changed from unknown to covered.",
              title: "Coverage changed for Kansas City tenant power",
            },
          ],
          source_signal_count: 0,
          total: 1,
        },
        isLoading: false,
      }),
    );

    await renderRoute();

    expect(screen.getByText("1 watch update")).toBeInTheDocument();
    expect(screen.getByText("0 source signals")).toBeInTheDocument();
    expect(screen.getByText("1 coverage change")).toBeInTheDocument();
    expect(screen.getByText("Coverage change")).toBeInTheDocument();
    expect(screen.getByText("Coverage changed for Kansas City tenant power")).toBeInTheDocument();
    expect(screen.getByText("Coverage changed from unknown to covered.")).toBeInTheDocument();
    expect(screen.getByText("coverage_target")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open source" })).not.toBeInTheDocument();
  });

  it("labels relationship, correction, and profile digest events", async () => {
    const digest = await import("@/domains/workspace/hooks/use-workspace-watch-digest");
    vi.mocked(digest.useWorkspaceWatchDigest).mockReturnValue(
      watchDigestQuery({
        data: {
          coverage_signal_count: 0,
          items: [
            {
              created_at: "2026-06-26T00:00:00Z",
              entry: null,
              event_type: "relationship_added",
              id: "event_relationship",
              resource_id: "entry_1",
              resource_type: "entry",
              source: null,
              summary: "A connection was added.",
              title: "New connection for KC Tenants",
            },
            {
              created_at: "2026-06-27T00:00:00Z",
              entry: null,
              event_type: "correction",
              id: "event_correction",
              resource_id: "entry_2",
              resource_type: "entry",
              source: null,
              summary: "A correction was recorded.",
              title: "Correction for a profile",
            },
            {
              created_at: "2026-06-28T00:00:00Z",
              entry: null,
              event_type: "profile_updated",
              id: "event_profile",
              resource_id: "entry_3",
              resource_type: "entry",
              source: null,
              summary: "A profile changed.",
              title: "Profile update for a civic actor",
            },
          ],
          source_signal_count: 0,
          total: 3,
        },
        isLoading: false,
      }),
    );

    await renderRoute();

    expect(screen.getByText("New connection")).toBeInTheDocument();
    expect(screen.getByText("Correction")).toBeInTheDocument();
    expect(screen.getByText("Profile update")).toBeInTheDocument();
  });

  it("falls back to an empty digest when the query has no data shape", async () => {
    const digest = await import("@/domains/workspace/hooks/use-workspace-watch-digest");
    vi.mocked(digest.useWorkspaceWatchDigest).mockReturnValue(
      watchDigestQuery({
        data: undefined,
        isLoading: false,
      }),
    );

    await renderRoute();

    expect(screen.getByText("No watch updates.")).toBeInTheDocument();
  });
});
