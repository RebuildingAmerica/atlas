// @vitest-environment jsdom
import "./discovery-page-test-setup";

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DiscoveryPage } from "@/domains/discovery/pages/discovery-page";
import { mocks } from "./discovery-page-test-setup";

afterEach(() => {
  cleanup();
});

describe("DiscoveryPage", () => {
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
});
