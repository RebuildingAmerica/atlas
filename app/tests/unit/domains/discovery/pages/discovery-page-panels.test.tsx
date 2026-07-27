// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { DiscoveryJobQueueResponse } from "@rebuildingamerica/atlas-api-client";
import {
  IngestionQualityPanel,
  ResearchOperationsPanel,
} from "@/domains/discovery/pages/discovery-page-panels";
import type { WorkspaceQualitySummary } from "@/domains/workspace/server/quality-summary";

describe("discovery page panels", () => {
  function queue(): DiscoveryJobQueueResponse {
    return {
      items: [
        {
          claimed_by: null,
          error_message: "Source fetch timed out.",
          id: "job_1",
          issue_areas: ["housing_affordability"],
          location_query: "Kansas City",
          progress: null,
          retry_count: 2,
          state: "MO",
          status: "failed",
        },
      ],
      status_counts: { claimed: 1, failed: 1, queued: 2, running: 3 },
      total: 1,
    } as DiscoveryJobQueueResponse;
  }

  function summary(): WorkspaceQualitySummary {
    return {
      confidence_distribution: [
        { record_count: 4, state: "corroborated" },
        { record_count: 2, state: "partial" },
        { record_count: 1, state: "unverified" },
      ],
      data_boundary: {
        private_notes_included: false,
        statement: "Private notes are excluded.",
      },
      duplicate_risk: { cluster_count: 1, clusters: [], record_count: 2 },
      generated_at: "2026-04-20T10:05:00.000Z",
      org_id: "org_123",
      source_coverage: {
        coverage_percent: 87.5,
        source_backed_records: 7,
        total_records: 8,
        unsourced_records: 1,
      },
      stale_records: {
        record_count: 1,
        records: [
          {
            id: "entry_1",
            latest_source_date: "2024-01-05",
            name: "Old Coalition",
            source_count: 1,
          },
        ],
        threshold_days: 365,
      },
    };
  }

  it("counts nothing queued while the queue has not loaded", () => {
    render(<ResearchOperationsPanel isLoading queue={undefined} />);

    expect(screen.getByText("0 queued")).toBeInTheDocument();
    expect(screen.getByText("0 running")).toBeInTheDocument();
    expect(screen.getByText("0 failed")).toBeInTheDocument();
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("says plainly when nothing is queued", () => {
    render(<ResearchOperationsPanel isLoading={false} queue={undefined} />);

    expect(screen.getByText("No research operations queued.")).toBeInTheDocument();
  });

  it("counts claimed jobs as running and surfaces a failed job's reason", () => {
    render(<ResearchOperationsPanel isLoading={false} queue={queue()} />);

    expect(screen.getByText("2 queued")).toBeInTheDocument();
    expect(screen.getByText("4 running")).toBeInTheDocument();
    expect(screen.getByText("1 failed")).toBeInTheDocument();
    expect(screen.getByText("Kansas City")).toBeInTheDocument();
    expect(screen.getByText("Source fetch timed out.")).toBeInTheDocument();
    expect(screen.getByText("Retry 2")).toBeInTheDocument();
  });

  it("shows no record count and no signals before quality data arrives", () => {
    render(<IngestionQualityPanel isLoading summary={undefined} />);

    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(screen.queryByText(/records$/)).not.toBeInTheDocument();
  });

  it("says plainly when there are no quality signals", () => {
    render(<IngestionQualityPanel isLoading={false} summary={undefined} />);

    expect(screen.getByText("No quality signals.")).toBeInTheDocument();
  });

  it("reads a single stale record in the singular", () => {
    render(<IngestionQualityPanel isLoading={false} summary={summary()} />);

    expect(screen.getByText("8 records")).toBeInTheDocument();
    expect(screen.getByText("87.5% source-backed")).toBeInTheDocument();
    expect(screen.getByText("1 duplicate cluster")).toBeInTheDocument();
    expect(screen.getByText("1 stale")).toBeInTheDocument();
    expect(screen.getByText("4 corroborated")).toBeInTheDocument();
    expect(screen.getByText("Old Coalition")).toBeInTheDocument();
    expect(screen.getByText(/2024-01-05/)).toHaveTextContent("2024-01-05 · 1 source");
    expect(screen.getByText("Private notes are excluded.")).toBeInTheDocument();
  });

  it("reads several stale sources in the plural and a missing bucket as zero", () => {
    const partial = summary();
    partial.confidence_distribution = [{ record_count: 4, state: "corroborated" }];
    partial.stale_records.records = [
      { id: "entry_2", latest_source_date: "2023-11-02", name: "Quiet Council", source_count: 3 },
    ];

    render(<IngestionQualityPanel isLoading={false} summary={partial} />);

    expect(screen.getByText(/2023-11-02/)).toHaveTextContent("2023-11-02 · 3 sources");
    expect(screen.getByText("4 corroborated")).toBeInTheDocument();
    expect(screen.getByText(/0 partial/)).toHaveTextContent("0 partial · 0 unverified");
  });
});
