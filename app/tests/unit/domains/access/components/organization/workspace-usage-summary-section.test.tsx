// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { WorkspaceUsageSummarySection } from "@/domains/access/components/organization/workspace-usage-summary-section";

describe("WorkspaceUsageSummarySection", () => {
  afterEach(cleanup);

  it("renders renewal signal totals and event counts", () => {
    render(
      <WorkspaceUsageSummarySection
        auditLog={{
          data_boundary: {
            metadata_included: false,
            session_replay_included: false,
            statement:
              "The audit log shows timestamped workspace usage events without private metadata or behavioral session replay.",
          },
          items: [
            {
              actor_id: "user_123",
              created_at: "2026-07-03T12:00:00.000Z",
              event_type: "api_call",
              id: "event_123",
              org_id: "org_123",
              resource_id: "GET /api/profiles/{slug}",
              resource_type: "api",
            },
            {
              actor_id: "user_123",
              created_at: "2026-07-03T11:30:00.000Z",
              event_type: "brief_opened",
              id: "event_124",
              org_id: "org_123",
              resource_id: "brief_123",
              resource_type: "brief",
            },
          ],
          limit: 10,
          offset: 0,
          org_id: "org_123",
          total: 2,
        }}
        integrationMonitoring={{
          api_calls: 2,
          data_boundary: {
            request_metadata_included: false,
            session_replay_included: false,
            statement:
              "Integration monitoring shows counts, surfaces, routes, and last-seen times without request metadata or behavioral session replay.",
          },
          last_seen_at: "2026-07-03T12:00:00.000Z",
          mcp_calls: 1,
          org_id: "org_123",
          top_resources: [
            {
              last_seen_at: "2026-07-03T11:30:00.000Z",
              resource_id: "/api/public-directories",
              surface: "api",
              total_calls: 2,
            },
            {
              last_seen_at: "2026-07-03T12:00:00.000Z",
              resource_id: "/mcp",
              surface: "mcp",
              total_calls: 1,
            },
          ],
          total_calls: 3,
        }}
        renewalPacketUrl="/api/orgs/org_123/usage-summary/renewal-packet?format=markdown"
        usageSummary={{
          event_counts: {
            brief_opened: 2,
            digest_viewed: 1,
            public_record_improved: 3,
          },
          org_id: "org_123",
          renewal_signals: {
            briefs_used: 2,
            coverage_gaps_closed: 4,
            integrations_used: 1,
            public_records_improved: 3,
            team_workflow_actions: 5,
          },
          total_events: 16,
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: "Renewal proof" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Renewal proof" }).closest("article"),
    ).toHaveAttribute("id", "renewal-proof");
    expect(screen.getByText("16")).toBeInTheDocument();
    expect(screen.getByText("Briefs used")).toBeInTheDocument();
    expect(screen.getByText("Coverage gaps closed")).toBeInTheDocument();
    expect(screen.getByText("Public records improved")).toBeInTheDocument();
    expect(screen.getAllByText("Brief opened")).toHaveLength(2);
    expect(screen.getByText("Digest viewed")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Access log" })).toBeInTheDocument();
    expect(screen.getByText("API call")).toBeInTheDocument();
    expect(screen.getByText("GET /api/profiles/{slug}")).toBeInTheDocument();
    expect(screen.getAllByText("Brief opened")).toHaveLength(2);
    expect(screen.getByText("Private metadata excluded")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Integration monitoring" })).toBeInTheDocument();
    expect(screen.getAllByText("REST API").length).toBeGreaterThan(0);
    expect(screen.getAllByText("MCP").length).toBeGreaterThan(0);
    expect(screen.getByText("Last seen Jul 3, 2026")).toBeInTheDocument();
    expect(screen.getByText("/api/public-directories")).toBeInTheDocument();
    expect(screen.getByText("/mcp")).toBeInTheDocument();
    expect(screen.getByText("Request metadata excluded")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download packet" })).toHaveAttribute(
      "href",
      "/api/orgs/org_123/usage-summary/renewal-packet?format=markdown",
    );
  });

  it("shows a plain empty state when no usage events exist", () => {
    render(
      <WorkspaceUsageSummarySection
        renewalPacketUrl="/api/orgs/org_123/usage-summary/renewal-packet?format=markdown"
        usageSummary={{
          event_counts: {},
          org_id: "org_123",
          renewal_signals: {
            briefs_used: 0,
            coverage_gaps_closed: 0,
            integrations_used: 0,
            public_records_improved: 0,
            team_workflow_actions: 0,
          },
          total_events: 0,
        }}
      />,
    );

    expect(screen.getByText("No renewal events yet.")).toBeInTheDocument();
  });

  it("keeps renewal proof visible when event counts are omitted", () => {
    render(
      <WorkspaceUsageSummarySection
        renewalPacketUrl="/api/orgs/org_123/usage-summary/renewal-packet?format=markdown"
        usageSummary={{
          org_id: "org_123",
          renewal_signals: {
            briefs_used: 2,
          },
          total_events: 2,
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: "Renewal proof" })).toBeInTheDocument();
    expect(screen.getByText("Briefs used")).toBeInTheDocument();
    expect(screen.getByText("Workflow actions")).toBeInTheDocument();
    expect(screen.queryByText("Brief opened")).not.toBeInTheDocument();
  });
});
