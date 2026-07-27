// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceWatchCollection } from "@/domains/workspace/server/watches";

const mocks = vi.hoisted(() => ({
  useAtlasSession: vi.fn(),
  useWorkspaceWatches: vi.fn(),
}));

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/workspace/hooks/use-workspace-watches", () => ({
  useWorkspaceWatches: mocks.useWorkspaceWatches,
}));

vi.mock("@/domains/access", () => ({
  useAtlasSession: mocks.useAtlasSession,
}));

describe("WorkspaceWatchesPage", () => {
  beforeEach(() => {
    mocks.useAtlasSession.mockReset();
    mocks.useWorkspaceWatches.mockReset();
    mocks.useAtlasSession.mockReturnValue({
      data: {
        workspace: {
          activeOrganization: {
            workspaceType: "team",
          },
        },
      },
    });
  });

  afterEach(() => {
    cleanup();
  });

  function collection(overrides?: Partial<WorkspaceWatchCollection>): WorkspaceWatchCollection {
    return {
      items: [
        {
          href: "/profiles/organizations/kc-tenants",
          label: "KC Tenants",
          location: "Kansas City, MO",
          resourceLabel: "Organization",
          watch: {
            created_at: "2026-06-25T00:00:00Z",
            created_by: "user_1",
            id: "watch_entry",
            notification_preference: "digest",
            org_id: "org_123",
            resource_id: "entry_123",
            resource_type: "entry",
            updated_at: "2026-06-26T00:00:00Z",
          },
        },
        {
          href: "/coverage/coverage_123",
          label: "Kansas City tenant power",
          location: "Kansas City, MO",
          resourceLabel: "Coverage target",
          status: "thin",
          watch: {
            created_at: "2026-06-24T00:00:00Z",
            created_by: "user_1",
            id: "watch_coverage",
            notification_preference: "muted",
            org_id: "org_123",
            resource_id: "coverage_123",
            resource_type: "coverage_target",
            updated_at: "2026-06-25T00:00:00Z",
          },
        },
      ],
      orgId: "org_123",
      total: 2,
      ...overrides,
    };
  }

  it("renders shared workspace watches with readable target context", async () => {
    const watches = collection();
    mocks.useWorkspaceWatches.mockReturnValue({ data: watches });

    const { WorkspaceWatchesPage } = await import("@/domains/workspace/pages/watches-page");
    render(<WorkspaceWatchesPage />);

    expect(mocks.useWorkspaceWatches).toHaveBeenCalledWith();
    expect(screen.getByRole("heading", { name: "Watching" })).toBeInTheDocument();
    expect(screen.getByText("2 watched resources")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open proof" })).toHaveAttribute(
      "data-link-to",
      "/organization",
    );
    expect(screen.getByRole("link", { name: "Open proof" })).toHaveAttribute(
      "data-link-hash",
      "renewal-proof",
    );
    expect(screen.getByRole("link", { name: "KC Tenants" })).toHaveAttribute(
      "href",
      "/profiles/organizations/kc-tenants",
    );
    expect(screen.getByText("Organization")).toBeInTheDocument();
    expect(screen.getAllByText("Kansas City, MO")).toHaveLength(2);
    expect(screen.getAllByText("Digest")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Kansas City tenant power" })).toHaveAttribute(
      "href",
      "/coverage/coverage_123",
    );
    expect(screen.getByText("Coverage target")).toBeInTheDocument();
    expect(screen.getByText("thin")).toBeInTheDocument();
    expect(screen.getAllByText("Muted")).toHaveLength(2);
  });

  it("renders an empty state when the workspace has no watches", async () => {
    const watches = collection({ items: [], total: 0 });
    mocks.useWorkspaceWatches.mockReturnValue({ data: watches });

    const { WorkspaceWatchesPage } = await import("@/domains/workspace/pages/watches-page");
    render(<WorkspaceWatchesPage />);

    expect(screen.getByText("No watched resources.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open coverage" })).toHaveAttribute(
      "data-link-to",
      "/coverage",
    );
    expect(screen.getByRole("link", { name: "Open proof" })).toBeInTheDocument();
  });

  it("does not render renewal proof links for personal workspaces", async () => {
    const watches = collection();
    mocks.useWorkspaceWatches.mockReturnValue({ data: watches });
    mocks.useAtlasSession.mockReturnValue({
      data: {
        workspace: {
          activeOrganization: {
            workspaceType: "individual",
          },
        },
      },
    });

    const { WorkspaceWatchesPage } = await import("@/domains/workspace/pages/watches-page");
    render(<WorkspaceWatchesPage />);

    expect(screen.getByRole("link", { name: "Open coverage" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open proof" })).not.toBeInTheDocument();
  });

  it("labels an immediate watch and keeps an unlinkable row readable", async () => {
    const watches = collection();
    watches.items = [
      {
        href: null,
        label: "Unpublished Actor",
        resourceLabel: "Person",
        watch: {
          created_at: "2026-06-25T00:00:00Z",
          created_by: "user_1",
          id: "watch_unlinked",
          notification_preference: "immediate",
          org_id: "org_123",
          resource_id: "entry_999",
          resource_type: "entry",
          updated_at: "2026-06-26T00:00:00Z",
        },
      },
    ];
    watches.total = 1;
    mocks.useWorkspaceWatches.mockReturnValue({ data: watches });

    const { WorkspaceWatchesPage } = await import("@/domains/workspace/pages/watches-page");
    render(<WorkspaceWatchesPage />);

    expect(screen.getByText("Immediate")).toBeInTheDocument();
    expect(screen.getByText("Unpublished Actor")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Unpublished Actor" })).not.toBeInTheDocument();
    expect(screen.queryByText("Kansas City, MO")).not.toBeInTheDocument();
  });
});
