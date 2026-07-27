// @vitest-environment jsdom

import { afterEach, beforeEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  useAtlasSession: vi.fn(),
  useCreateCoverageTarget: vi.fn(),
  useCreateWorkspaceBrief: vi.fn(),
  useDiscoveryJobQueue: vi.fn(),
  useDiscoveryRuns: vi.fn(),
  useStartDiscovery: vi.fn(),
  useWatchWorkspaceResource: vi.fn(),
  useWorkspaceQualitySummary: vi.fn(),
  useTaxonomy: vi.fn(),
}));

export { mocks };

/** The callbacks a component hands to a React Query mutation's `mutate`. */
export interface MutationCallbacks {
  onError?: (error: Error) => void;
  onSettled?: () => void;
  onSuccess?: (result: { id: string; name: string; title: string }) => void;
}

export const FREE_TIER_SESSION = {
  data: {
    workspace: {
      activeOrganization: null,
      activeProducts: [],
      capabilities: { canUseTeamFeatures: false },
      resolvedCapabilities: {
        capabilities: ["research.run"],
        limits: {
          research_runs_per_month: 2,
          max_shortlists: 1,
          max_shortlist_entries: 25,
          max_api_keys: 0,
          api_requests_per_day: 0,
          public_api_requests_per_hour: 100,
          max_members: 1,
        },
      },
      onboarding: { needsWorkspace: false, hasPendingInvitations: false },
    },
  },
};

vi.mock("@/domains/access", () => ({
  useAtlasSession: mocks.useAtlasSession,
}));

vi.mock("@/domains/discovery/hooks/use-discovery", () => ({
  useDiscoveryJobQueue: mocks.useDiscoveryJobQueue,
  useDiscoveryRuns: mocks.useDiscoveryRuns,
  useStartDiscovery: mocks.useStartDiscovery,
}));

vi.mock("@rebuildingamerica/atlas-catalog/hooks/use-taxonomy", () => ({
  useTaxonomy: mocks.useTaxonomy,
}));

vi.mock("@/domains/workspace/hooks/use-briefs", () => ({
  useCreateWorkspaceBrief: mocks.useCreateWorkspaceBrief,
}));

vi.mock("@/domains/workspace/hooks/use-coverage-targets", () => ({
  useCreateCoverageTarget: mocks.useCreateCoverageTarget,
}));

vi.mock("@/domains/workspace/hooks/use-workspace-watches", () => ({
  useWatchWorkspaceResource: mocks.useWatchWorkspaceResource,
}));

vi.mock("@/domains/workspace/hooks/use-workspace-quality-summary", () => ({
  useWorkspaceQualitySummary: mocks.useWorkspaceQualitySummary,
}));

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

beforeEach(() => {
  mocks.useAtlasSession.mockReturnValue({ data: null });
  mocks.useCreateCoverageTarget.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  });
  mocks.useCreateWorkspaceBrief.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  });
  mocks.useDiscoveryJobQueue.mockReturnValue({
    data: {
      items: [],
      status_counts: { claimed: 0, failed: 0, queued: 0, running: 0 },
      total: 0,
    },
    isLoading: false,
  });
  mocks.useDiscoveryRuns.mockReturnValue({ data: { items: [] }, isLoading: false });
  mocks.useStartDiscovery.mockReturnValue({ mutate: vi.fn(), isPending: false, error: null });
  mocks.useWatchWorkspaceResource.mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
  });
  mocks.useWorkspaceQualitySummary.mockReturnValue({
    data: {
      confidence_distribution: [
        { record_count: 0, state: "corroborated" },
        { record_count: 0, state: "partial" },
        { record_count: 0, state: "unverified" },
      ],
      data_boundary: {
        private_notes_included: false,
        statement: "Private notes are excluded.",
      },
      duplicate_risk: { cluster_count: 0, clusters: [], record_count: 0 },
      org_id: "org_123",
      source_coverage: {
        coverage_percent: 0,
        source_backed_records: 0,
        total_records: 0,
        unsourced_records: 0,
      },
      stale_records: { record_count: 0, records: [], threshold_days: 365 },
    },
    isLoading: false,
  });
  mocks.useTaxonomy.mockReturnValue({
    data: { "Domain 1": [{ name: "Issue 1", slug: "issue-1", description: "desc" }] },
    isLoading: false,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
