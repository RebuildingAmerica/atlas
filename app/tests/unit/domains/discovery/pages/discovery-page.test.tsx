// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { DiscoveryPage } from "@/domains/discovery/pages/discovery-page";

const mocks = vi.hoisted(() => ({
  useAtlasSession: vi.fn(),
  useCreateWorkspaceBrief: vi.fn(),
  useDiscoveryJobQueue: vi.fn(),
  useDiscoveryRuns: vi.fn(),
  useStartDiscovery: vi.fn(),
  useWorkspaceQualitySummary: vi.fn(),
  useTaxonomy: vi.fn(),
}));

vi.mock("@/domains/access", () => ({
  useAtlasSession: mocks.useAtlasSession,
}));

vi.mock("@/domains/discovery/hooks/use-discovery", () => ({
  useDiscoveryJobQueue: mocks.useDiscoveryJobQueue,
  useDiscoveryRuns: mocks.useDiscoveryRuns,
  useStartDiscovery: mocks.useStartDiscovery,
}));

vi.mock("@/domains/catalog/hooks/use-taxonomy", () => ({
  useTaxonomy: mocks.useTaxonomy,
}));

vi.mock("@/domains/workspace/hooks/use-briefs", () => ({
  useCreateWorkspaceBrief: mocks.useCreateWorkspaceBrief,
}));

vi.mock("@/domains/workspace/hooks/use-workspace-quality-summary", () => ({
  useWorkspaceQualitySummary: mocks.useWorkspaceQualitySummary,
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params,
    to,
    search,
  }: {
    children: React.ReactNode;
    params?: { briefId?: string };
    to: string;
    search?: { intent?: string };
  }) => {
    const href = params?.briefId ? to.replace("$briefId", params.briefId) : to;
    return <a href={search?.intent ? `${href}?intent=${search.intent}` : href}>{children}</a>;
  },
}));

describe("DiscoveryPage", () => {
  const FREE_TIER_SESSION = {
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

  beforeEach(() => {
    mocks.useAtlasSession.mockReturnValue({ data: null });
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

  it("puts recent research before the research form without an eyebrow hero", () => {
    render(<DiscoveryPage />);
    const recentRunsHeading = screen.getByRole("heading", { level: 1, name: "Recent research" });
    const newRunHeading = screen.getByRole("heading", {
      level: 2,
      name: "New research request",
    });

    expect(screen.queryByText("Team discovery")).not.toBeInTheDocument();
    expect(screen.queryByText(/^Discovery$/)).not.toBeInTheDocument();
    expect(
      recentRunsHeading.compareDocumentPosition(newRunHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("shows research operations queue and worker visibility", () => {
    mocks.useDiscoveryJobQueue.mockReturnValue({
      data: {
        items: [
          {
            claimed_by: "worker-a",
            claimed_until: "2026-07-03T12:15:00.000Z",
            created_at: "2026-07-03T12:00:00.000Z",
            error_message: null,
            id: "job_1",
            issue_areas: ["worker_power"],
            location_query: "Phoenix, AZ",
            max_retries: 2,
            next_attempt_at: null,
            progress: { step: "fetching_sources" },
            retry_count: 0,
            run_id: "run_1",
            started_at: "2026-07-03T12:00:00.000Z",
            state: "AZ",
            status: "running",
          },
        ],
        status_counts: { claimed: 0, failed: 0, queued: 1, running: 1 },
        total: 2,
      },
      isLoading: false,
    });

    render(<DiscoveryPage />);

    expect(screen.getByRole("heading", { name: "Research operations" })).toBeInTheDocument();
    expect(screen.getByText("1 queued")).toBeInTheDocument();
    expect(screen.getByText("1 running")).toBeInTheDocument();
    expect(screen.getByText("0 failed")).toBeInTheDocument();
    expect(screen.getByText("Phoenix, AZ")).toBeInTheDocument();
    expect(screen.getByText("worker-a")).toBeInTheDocument();
  });

  it("shows ingestion quality signals for workspace records", () => {
    mocks.useWorkspaceQualitySummary.mockReturnValue({
      data: {
        confidence_distribution: [
          { record_count: 3, state: "corroborated" },
          { record_count: 2, state: "partial" },
          { record_count: 1, state: "unverified" },
        ],
        data_boundary: {
          private_notes_included: false,
          statement: "Private notes are excluded.",
        },
        duplicate_risk: {
          cluster_count: 1,
          clusters: [
            {
              key: "Duplicate Worker Center (Detroit, MI)",
              record_count: 2,
              records: [
                { id: "entry_1", name: "Duplicate Worker Center" },
                { id: "entry_2", name: "Duplicate Worker Center" },
              ],
            },
          ],
          record_count: 2,
        },
        org_id: "org_123",
        source_coverage: {
          coverage_percent: 83.3,
          source_backed_records: 5,
          total_records: 6,
          unsourced_records: 1,
        },
        stale_records: {
          record_count: 1,
          records: [
            {
              id: "entry_3",
              latest_source_date: "2020-01-01",
              name: "Tenant Legal Clinic",
              source_count: 1,
            },
          ],
          threshold_days: 365,
        },
      },
      isLoading: false,
    });

    render(<DiscoveryPage />);

    expect(screen.getByRole("heading", { name: "Ingestion quality" })).toBeInTheDocument();
    expect(screen.getByText("83.3% source-backed")).toBeInTheDocument();
    expect(screen.getByText("1 unsourced")).toBeInTheDocument();
    expect(screen.getByText("1 duplicate cluster")).toBeInTheDocument();
    expect(screen.getByText("1 stale")).toBeInTheDocument();
    expect(screen.getByText("3 corroborated")).toBeInTheDocument();
    expect(screen.getByText("Tenant Legal Clinic")).toBeInTheDocument();
    expect(screen.getByText("Private notes are excluded.")).toBeInTheDocument();
  });

  it("shows setup notice when workspace is needed", () => {
    mocks.useAtlasSession.mockReturnValue({
      data: {
        workspace: {
          activeOrganization: null,
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
          onboarding: { needsWorkspace: true, hasPendingInvitations: false },
        },
      },
    });

    render(<DiscoveryPage />);
    expect(screen.getByText(/Create your workspace/i)).toBeInTheDocument();
  });

  it("renders issue areas from taxonomy", () => {
    render(<DiscoveryPage />);
    expect(screen.getByText("Issue 1")).toBeInTheDocument();
    expect(screen.queryByText("desc")).not.toBeInTheDocument();
  });

  it("handles form input and toggles issues", () => {
    render(<DiscoveryPage />);

    const locationInput = screen.getByPlaceholderText(/Kansas City, MO/i);
    fireEvent.change(locationInput, { target: { value: "New York" } });
    expect(locationInput).toHaveValue("New York");

    const stateInput = screen.getByPlaceholderText(/^MO$/i);
    fireEvent.change(stateInput, { target: { value: "ny" } });
    expect(stateInput).toHaveValue("NY");

    const checkbox = screen.getByRole("checkbox");
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
    expect(screen.getByText("1 selected")).toBeInTheDocument();
  });

  it("prefills a research request from a coverage gap", () => {
    mocks.useTaxonomy.mockReturnValue({
      data: {
        Housing: [
          {
            name: "Housing affordability",
            slug: "housing_affordability",
            description: "Tenant protections and housing costs",
          },
        ],
      },
      isLoading: false,
    });

    render(
      <DiscoveryPage
        initialRequest={{
          issue_areas: "housing_affordability",
          location: "Kansas City, MO",
          research_goal: "partner_scan",
          state: "mo",
        }}
      />,
    );

    expect(screen.getByPlaceholderText(/Kansas City, MO/i)).toHaveValue("Kansas City, MO");
    expect(screen.getByPlaceholderText(/^MO$/i)).toHaveValue("MO");
    expect(screen.getByLabelText("Partner scan")).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Housing affordability" })).toBeChecked();
    expect(screen.getByText("1 selected")).toBeInTheDocument();
  });

  it("submits a research request", () => {
    const mutate = vi.fn();
    mocks.useStartDiscovery.mockReturnValue({ mutate, isPending: false, error: null });
    mocks.useAtlasSession.mockReturnValue({
      data: {
        workspace: {
          activeOrganization: null,
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
    });

    render(<DiscoveryPage />);

    fireEvent.change(screen.getByPlaceholderText(/Kansas City, MO/i), {
      target: { value: "New York" },
    });
    fireEvent.change(screen.getByPlaceholderText(/^MO$/i), { target: { value: "ny" } });
    fireEvent.click(screen.getByRole("checkbox"));

    fireEvent.click(screen.getByRole("button", { name: "Start research" }));

    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        location_query: "New York",
        state: "NY",
        issue_areas: ["issue-1"],
        research_goal: "landscape_scan",
      }),
      expect.any(Object),
    );
  });

  it("submits the selected research goal", () => {
    const mutate = vi.fn();
    mocks.useStartDiscovery.mockReturnValue({ mutate, isPending: false, error: null });
    mocks.useAtlasSession.mockReturnValue({
      data: {
        workspace: {
          activeOrganization: null,
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
    });

    render(<DiscoveryPage />);

    fireEvent.change(screen.getByPlaceholderText(/Kansas City, MO/i), {
      target: { value: "New York" },
    });
    fireEvent.change(screen.getByPlaceholderText(/^MO$/i), { target: { value: "ny" } });
    fireEvent.click(screen.getByLabelText("Interview leads"));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Start research" }));

    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        research_goal: "interview_leads",
      }),
      expect.any(Object),
    );
  });

  it("keeps goal choices compact while preserving the selected goal context", () => {
    render(<DiscoveryPage />);

    fireEvent.click(screen.getByLabelText("Interview leads"));

    expect(screen.getAllByText("Interview leads").length).toBeGreaterThan(0);
    expect(
      screen.getByText("Best for source lists, reporting calls, and first outreach."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Ranked people and organizations")).not.toBeInTheDocument();
    expect(screen.queryByText("Contact and reachability signals")).not.toBeInTheDocument();
    expect(screen.queryByText("Recent source context")).not.toBeInTheDocument();
  });

  it("explains the local landscape flow before a run starts", () => {
    render(<DiscoveryPage />);

    expect(screen.getAllByText("Landscape scan").length).toBeGreaterThan(0);
    expect(
      screen.getByText("Best for understanding who is active around a place and issue."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Ranked local actors")).not.toBeInTheDocument();
    expect(screen.queryByText("Key sources")).not.toBeInTheDocument();
    expect(screen.queryByText("Coverage gaps")).not.toBeInTheDocument();
  });

  it("does not expose template shortcuts in the run form", () => {
    mocks.useTaxonomy.mockReturnValue({
      data: {
        Housing: [
          {
            name: "Housing affordability",
            slug: "housing_affordability",
            description: "Tenant protections and housing costs",
          },
        ],
        Labor: [
          {
            name: "Worker power",
            slug: "worker_power",
            description: "Worker centers and labor campaigns",
          },
        ],
      },
      isLoading: false,
    });

    render(<DiscoveryPage />);

    expect(screen.queryByRole("button", { name: "Local partner scan" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Research templates" })).not.toBeInTheDocument();
  });

  it("renders a recent run without an error message when none is set", () => {
    mocks.useDiscoveryRuns.mockReturnValue({
      data: {
        items: [
          {
            id: "run_1",
            location_query: "Chicago",
            research_goal: "landscape_scan",
            started_at: "2026-04-20T10:00:00.000Z",
            state: "IL",
            status: "completed",
            issue_areas: ["area1"],
            entries_extracted: 10,
            sources_fetched: 5,
            entries_after_dedup: 8,
            error_message: null,
          },
        ],
      },
      isLoading: false,
    });
    render(<DiscoveryPage />);
    expect(screen.getByText("Chicago")).toBeInTheDocument();
    expect(screen.queryByText(/Process failed/)).toBeNull();
  });

  it("renders the in-flight start-run label when the start mutation is pending", () => {
    mocks.useStartDiscovery.mockReturnValue({
      mutate: vi.fn(),
      isPending: true,
      error: null,
    });
    render(<DiscoveryPage />);
    expect(screen.getByText(/Starting\.\.\./)).toBeInTheDocument();
  });

  it("renders recent runs and handles error messages", () => {
    mocks.useDiscoveryRuns.mockReturnValue({
      data: {
        items: [
          {
            id: "run_1",
            location_query: "Chicago",
            research_goal: "landscape_scan",
            started_at: "2026-04-20T10:00:00.000Z",
            state: "IL",
            status: "completed",
            issue_areas: ["area1"],
            entries_extracted: 10,
            sources_fetched: 5,
            entries_after_dedup: 8,
            error_message: "Process failed",
          },
        ],
      },
      isLoading: false,
    });

    render(<DiscoveryPage />);
    expect(screen.getByText("Chicago")).toBeInTheDocument();
    expect(screen.getByText("Process failed")).toBeInTheDocument();
  });

  it("renders structured research output for completed runs", () => {
    mocks.useDiscoveryRuns.mockReturnValue({
      data: {
        items: [
          {
            id: "run_1",
            location_query: "Kansas City",
            research_goal: "interview_leads",
            started_at: "2026-04-20T10:00:00.000Z",
            state: "MO",
            status: "completed",
            issue_areas: ["housing_affordability"],
            entries_extracted: 10,
            sources_fetched: 5,
            entries_after_dedup: 8,
            error_message: null,
            research_summary: {
              brief: "Three source-backed tenant leads in Kansas City.",
              ranked_leads: [
                {
                  entry_id: "entry-1",
                  name: "KC Tenants",
                  type: "organization",
                  why_it_matters: "Named by city and community sources.",
                  source_count: 2,
                  confidence: "corroborated",
                  latest_source_date: "2026-04-19",
                },
              ],
              key_sources: [
                {
                  source_id: "source-1",
                  title: "Tenant meeting agenda",
                  url: "https://example.test/agenda",
                  publication: "City Council",
                  published_date: "2026-04-19",
                  why_it_matters: "Names the lead and issue.",
                },
              ],
              gaps: [{ label: "County groups", detail: "No suburban source yet." }],
              reasoning_signals: ["Two independent sources point to the same actor."],
            },
          },
        ],
      },
      isLoading: false,
    });

    render(<DiscoveryPage />);

    expect(
      screen.getByText("Three source-backed tenant leads in Kansas City."),
    ).toBeInTheDocument();
    expect(screen.getAllByText("KC Tenants")).toHaveLength(1);
    expect(screen.getAllByText("Corroborated")).toHaveLength(1);
    expect(screen.getByText("Named by city and community sources.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Sync readiness" })).not.toBeInTheDocument();
    expect(screen.queryByText("Ready for CRM or newsroom handoff")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Tenant meeting agenda" })).toHaveAttribute(
      "href",
      "https://example.test/agenda",
    );
    expect(screen.getByText("County groups")).toBeInTheDocument();
    expect(screen.getByText("No suburban source yet.")).toBeInTheDocument();
  });

  it("copies stable research artifacts for agent and editorial workflows", async () => {
    const clipboardWriteText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: clipboardWriteText,
      },
    });
    mocks.useDiscoveryRuns.mockReturnValue({
      data: {
        items: [
          {
            id: "run_1",
            location_query: "Kansas City",
            research_goal: "interview_leads",
            started_at: "2026-04-20T10:00:00.000Z",
            completed_at: "2026-04-20T10:05:00.000Z",
            state: "MO",
            status: "completed",
            issue_areas: ["housing_affordability"],
            queries_generated: 2,
            sources_fetched: 5,
            sources_processed: 5,
            entries_extracted: 10,
            entries_after_dedup: 8,
            entries_confirmed: 3,
            error_message: null,
            research_summary: {
              brief: "Three source-backed tenant leads in Kansas City.",
              ranked_leads: [
                {
                  entry_id: "entry-1",
                  name: "KC Tenants",
                  type: "organization",
                  why_it_matters: "Named by city and community sources.",
                  source_count: 2,
                  confidence: "corroborated",
                  latest_source_date: "2026-04-19",
                },
              ],
              key_sources: [
                {
                  source_id: "source-1",
                  title: "Tenant meeting agenda",
                  url: "https://example.test/agenda",
                  publication: "City Council",
                  published_date: "2026-04-19",
                  why_it_matters: "Names the lead and issue.",
                },
              ],
              gaps: [{ label: "County groups", detail: "No suburban source yet." }],
              reasoning_signals: ["Two independent sources point to the same actor."],
            },
          },
        ],
      },
      isLoading: false,
    });

    render(<DiscoveryPage />);

    expect(screen.queryByText("Export artifacts")).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy agent JSON" }));
      await Promise.resolve();
    });
    expect(clipboardWriteText).toHaveBeenCalledWith(
      expect.stringContaining('"schema_version": "atlas.research_artifact.v1"'),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy editorial brief" }));
      await Promise.resolve();
    });
    expect(clipboardWriteText).toHaveBeenLastCalledWith(
      expect.stringContaining("# Kansas City research brief"),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy leads CSV" }));
      await Promise.resolve();
    });
    expect(clipboardWriteText).toHaveBeenLastCalledWith(
      expect.stringContaining("rank,name,type,confidence,source_count"),
    );
  });

  it("saves a completed research summary as an Atlas Brief", async () => {
    interface CreatedBrief {
      id: string;
      title: string;
    }

    interface CreateBriefMutationOptions {
      onSettled?: () => void;
      onSuccess?: (brief: CreatedBrief) => void;
    }

    const createBrief = vi.fn((_input: unknown, options?: CreateBriefMutationOptions) => {
      options?.onSuccess?.({
        id: "brief_123",
        title: "Kansas City Interview leads",
      });
      options?.onSettled?.();
    });
    mocks.useCreateWorkspaceBrief.mockReturnValue({
      mutate: createBrief,
      isPending: false,
    });
    mocks.useDiscoveryRuns.mockReturnValue({
      data: {
        items: [
          {
            id: "run_1",
            location_query: "Kansas City",
            research_goal: "interview_leads",
            started_at: "2026-04-20T10:00:00.000Z",
            completed_at: "2026-04-20T10:05:00.000Z",
            state: "MO",
            status: "completed",
            issue_areas: ["housing_affordability"],
            queries_generated: 2,
            sources_fetched: 5,
            sources_processed: 5,
            entries_extracted: 10,
            entries_after_dedup: 8,
            entries_confirmed: 3,
            error_message: null,
            research_summary: {
              brief: "Three source-backed tenant leads in Kansas City.",
              ranked_leads: [
                {
                  entry_id: "entry_1",
                  name: "KC Tenants",
                  type: "organization",
                  why_it_matters: "Named by city and community sources.",
                  source_count: 2,
                  confidence: "corroborated",
                  latest_source_date: "2026-04-19",
                },
              ],
              key_sources: [
                {
                  source_id: "source_1",
                  title: "Tenant meeting agenda",
                  url: "https://example.test/agenda",
                  publication: "City Council",
                  published_date: "2026-04-19",
                  why_it_matters: "Names the lead and issue.",
                },
              ],
              gaps: [{ label: "County groups", detail: "No suburban source yet." }],
              reasoning_signals: ["Two independent sources point to the same actor."],
            },
          },
        ],
      },
      isLoading: false,
    });

    render(<DiscoveryPage />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save as Atlas Brief" }));
      await Promise.resolve();
    });

    expect(createBrief).toHaveBeenCalledWith(
      expect.objectContaining({
        linked_discovery_run_ids: ["run_1"],
        linked_entry_ids: ["entry_1"],
        linked_source_ids: ["source_1"],
        title: "Kansas City Interview leads",
      }),
      expect.any(Object),
    );
    expect(screen.getByRole("link", { name: "Open brief" })).toHaveAttribute(
      "href",
      "/briefs/brief_123",
    );
  });

  it("renders ranked leads without a nested recommended lead set card", () => {
    mocks.useDiscoveryRuns.mockReturnValue({
      data: {
        items: [
          {
            id: "run_1",
            location_query: "Kansas City",
            research_goal: "interview_leads",
            started_at: "2026-04-20T10:00:00.000Z",
            state: "MO",
            status: "completed",
            issue_areas: ["housing_affordability"],
            entries_extracted: 10,
            sources_fetched: 5,
            entries_after_dedup: 8,
            error_message: null,
            research_summary: {
              brief: "Three source-backed tenant leads in Kansas City.",
              ranked_leads: [
                {
                  entry_id: "entry-1",
                  name: "KC Tenants",
                  type: "organization",
                  why_it_matters: "Named by city and community sources.",
                  source_count: 2,
                  confidence: "corroborated",
                  latest_source_date: "2026-04-19",
                },
                {
                  entry_id: "entry-2",
                  name: "Tenant Hotline",
                  type: "organization",
                  why_it_matters: "Shows direct reachability for renter interviews.",
                  source_count: 1,
                  latest_source_date: "2026-04-18",
                },
              ],
              key_sources: [],
              gaps: [],
              reasoning_signals: [],
            },
          },
        ],
      },
      isLoading: false,
    });

    render(<DiscoveryPage />);

    expect(screen.queryByText("Recommended lead set")).not.toBeInTheDocument();
    expect(screen.queryByText("Interview source set")).not.toBeInTheDocument();
    expect(screen.queryByText("First calls from the ranked leads.")).not.toBeInTheDocument();
    expect(screen.getAllByText("KC Tenants")).toHaveLength(1);
    expect(screen.getAllByText("Tenant Hotline")).toHaveLength(1);
    expect(screen.getByText("2 sources")).toBeInTheDocument();
    expect(screen.getAllByText("Partial")).toHaveLength(1);
  });

  it("surfaces likely missing actor categories from completed research runs", () => {
    mocks.useDiscoveryRuns.mockReturnValue({
      data: {
        items: [
          {
            id: "run_1",
            location_query: "Kansas City",
            research_goal: "interview_leads",
            started_at: "2026-04-20T10:00:00.000Z",
            state: "MO",
            status: "completed",
            issue_areas: ["housing_affordability"],
            entries_extracted: 6,
            sources_fetched: 4,
            entries_after_dedup: 3,
            error_message: null,
            research_summary: {
              brief: "Organization-heavy tenant leads in Kansas City.",
              ranked_leads: [
                {
                  entry_id: "entry-1",
                  name: "KC Tenants",
                  type: "organization",
                  why_it_matters: "Named by city and community sources.",
                  source_count: 2,
                  confidence: "corroborated",
                  latest_source_date: "2026-04-19",
                },
              ],
              key_sources: [],
              gaps: [{ label: "County groups", detail: "No suburban source yet." }],
              reasoning_signals: [],
            },
          },
        ],
      },
      isLoading: false,
    });

    render(<DiscoveryPage />);

    expect(screen.getByText("Blind spots")).toBeInTheDocument();
    expect(screen.getByText("Named people")).toBeInTheDocument();
    expect(screen.getByText("No named person leads in the ranked set.")).toBeInTheDocument();
    expect(screen.getByText("County groups")).toBeInTheDocument();
    expect(screen.getByText("No suburban source yet.")).toBeInTheDocument();
  });

  it("shows loading state for runs", () => {
    mocks.useDiscoveryRuns.mockReturnValue({ data: null, isLoading: true });
    mocks.useTaxonomy.mockReturnValue({ data: null, isLoading: true });

    render(<DiscoveryPage />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("shows unavailable message when taxonomy is empty", () => {
    mocks.useTaxonomy.mockReturnValue({ data: {}, isLoading: false });

    render(<DiscoveryPage />);
    expect(screen.getByText(/Could not load issue areas/i)).toBeInTheDocument();
  });

  it("shows start error message when mutation fails", () => {
    mocks.useStartDiscovery.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      error: new Error("Fail"),
    });

    render(<DiscoveryPage />);
    expect(screen.getByRole("alert")).toHaveTextContent(/Could not start research/i);
  });

  it("keeps team workspace context out of a separate hero", () => {
    mocks.useAtlasSession.mockReturnValue({
      data: {
        workspace: {
          activeOrganization: {
            id: "org_1",
            name: "Atlas Team",
            role: "owner",
            workspaceType: "team",
          },
          capabilities: { canUseTeamFeatures: true },
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
    });

    render(<DiscoveryPage />);
    expect(screen.queryByText("Team discovery")).not.toBeInTheDocument();
    expect(screen.queryByText("Atlas Team discovery")).not.toBeInTheDocument();
    expect(screen.getByText("Recent research")).toBeInTheDocument();
  });

  it("removes an already-selected issue when toggled twice", () => {
    render(<DiscoveryPage />);
    const checkbox = screen.getByRole("checkbox");
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
    fireEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();
  });

  it("renders the pending-invitations notice when invitations are waiting", () => {
    mocks.useAtlasSession.mockReturnValue({
      data: {
        workspace: {
          activeOrganization: null,
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
          onboarding: { needsWorkspace: false, hasPendingInvitations: true },
        },
      },
    });
    render(<DiscoveryPage />);
    expect(screen.getByText(/You have workspace invitations waiting/)).toBeInTheDocument();
  });

  it("renders the upgrade prompt when research capability is missing", () => {
    mocks.useAtlasSession.mockReturnValue({
      data: {
        workspace: {
          activeOrganization: null,
          activeProducts: ["atlas_pro"],
          capabilities: { canUseTeamFeatures: false },
          resolvedCapabilities: {
            capabilities: [],
            limits: {
              research_runs_per_month: 0,
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
    });
    render(<DiscoveryPage />);
    // Upgrade prompts should be visible.
    expect(screen.getByText(/Atlas/)).toBeInTheDocument();
  });

  it("renders the free-tier upgrade prompt when activeProducts is empty", () => {
    mocks.useAtlasSession.mockReturnValue({
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
    });
    render(<DiscoveryPage />);
    // Some upgrade prompt should render.
    expect(screen.getByRole("heading", { level: 1, name: "Recent research" })).toBeInTheDocument();
  });

  it("sorts taxonomy issue areas alphabetically", () => {
    mocks.useTaxonomy.mockReturnValue({
      data: {
        Domain: [
          { name: "Zebra protection", slug: "zebra", description: "" },
          { name: "Apple orchards", slug: "apple", description: "" },
          { name: "Mango farms", slug: "mango", description: "" },
        ],
      },
      isLoading: false,
    });
    render(<DiscoveryPage />);
    const labels = screen.getAllByRole("checkbox").map((el) => el.parentElement?.textContent);
    const apple = labels.findIndex((label) => label?.includes("Apple"));
    const zebra = labels.findIndex((label) => label?.includes("Zebra"));
    expect(apple).toBeLessThan(zebra);
  });

  it("ignores form submissions with missing fields", () => {
    const mutate = vi.fn();
    mocks.useStartDiscovery.mockReturnValue({ mutate, isPending: false, error: null });
    mocks.useAtlasSession.mockReturnValue({
      data: {
        workspace: {
          activeOrganization: null,
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
    });

    render(<DiscoveryPage />);
    // Submit without filling anything in.
    const form = screen.getByRole("button", { name: "Start research" }).closest("form");
    if (!form) throw new Error("Expected discovery form");
    fireEvent.submit(form);
    expect(mutate).not.toHaveBeenCalled();
  });

  it("clears form on successful submission", () => {
    let successCallback: (() => void) | undefined;
    const mutate = vi
      .fn()
      .mockImplementation((_data: unknown, options: { onSuccess?: () => void }) => {
        successCallback = options.onSuccess;
      });
    mocks.useStartDiscovery.mockReturnValue({ mutate, isPending: false, error: null });
    mocks.useAtlasSession.mockReturnValue({
      data: {
        workspace: {
          activeOrganization: null,
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
    });

    render(<DiscoveryPage />);

    const locationInput = screen.getByPlaceholderText(/Kansas City, MO/i);
    fireEvent.change(locationInput, { target: { value: "New York" } });
    fireEvent.change(screen.getByPlaceholderText(/^MO$/i), { target: { value: "ny" } });
    fireEvent.click(screen.getByRole("checkbox"));

    fireEvent.click(screen.getByRole("button", { name: "Start research" }));

    if (!successCallback) throw new Error("Expected successCallback to be set");
    const callback = successCallback;
    act(() => {
      callback();
    });

    expect(locationInput).toHaveValue("");
  });

  it("surfaces an in-the-moment upgrade prompt when a run is blocked at the limit", async () => {
    const { AtlasApiError, ATLAS_API_ERROR_CODE } = await import("@/domains/discovery/api-errors");
    mocks.useStartDiscovery.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      error: new AtlasApiError(ATLAS_API_ERROR_CODE.AT_LIMIT),
    });
    mocks.useAtlasSession.mockReturnValue(FREE_TIER_SESSION);

    render(<DiscoveryPage />);

    expect(screen.getByText(/You've used your free research this month/)).toBeInTheDocument();
    // The generic inline error must be suppressed for the at-limit case.
    expect(screen.queryByText(/Could not start research/)).toBeNull();
    // The CTA routes to pricing carrying the Atlas Pro intent.
    const upgrade = screen.getByText("Upgrade").closest("a");
    expect(upgrade).toHaveAttribute("href", "/pricing?intent=atlas_pro");
  });

  it("shows safe retry copy when Atlas is temporarily unavailable", async () => {
    const { AtlasApiError, ATLAS_API_ERROR_CODE } = await import("@/domains/discovery/api-errors");
    mocks.useStartDiscovery.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      error: new AtlasApiError(ATLAS_API_ERROR_CODE.TEMPORARILY_UNAVAILABLE),
    });
    mocks.useAtlasSession.mockReturnValue(FREE_TIER_SESSION);

    render(<DiscoveryPage />);

    expect(screen.getByText(/Atlas is temporarily unavailable/)).toBeInTheDocument();
    expect(screen.queryByText(/You've used your free research this month/)).toBeNull();
  });
});
