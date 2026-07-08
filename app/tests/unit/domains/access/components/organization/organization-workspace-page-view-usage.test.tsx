// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { buildController } from "../../../../../helpers/access/organization-workspace-page-view-test-bed";
import { OrganizationWorkspacePageView } from "@/domains/access/components/organization/organization-workspace-page-view";

afterEach(() => {
  cleanup();
});

describe("OrganizationWorkspacePageView", () => {
  it("renders the seats & cost section when a team seat-cost summary is loaded", () => {
    const controller = buildController({
      teamSeatCostSummary: {
        interval: "monthly",
        seatsUsed: 1,
        maxSeats: 50,
        additionalSeats: 0,
        baseCents: 2500,
        perSeatCents: 800,
        additionalSeatsCents: 0,
        totalCents: 2500,
      },
    });

    render(<OrganizationWorkspacePageView controller={controller} />);
    expect(screen.getByText(/Seats & cost/i)).toBeInTheDocument();
    expect(screen.getByText(/1 of 50 seats used/i)).toBeInTheDocument();
  });

  it("shows enterprise package access and limits to workspace admins", () => {
    const controller = buildController({
      session: {
        user: { id: "user_1" },
        workspace: {
          activeProducts: ["atlas_field_intelligence"],
          resolvedCapabilities: {
            capabilities: [
              "research.run",
              "research.unlimited",
              "workspace.export",
              "workspace.shared",
              "monitoring.watchlists",
              "coverage.targets",
              "integrations.slack",
            ],
            limits: {
              research_runs_per_month: null,
              max_shortlists: null,
              max_shortlist_entries: null,
              max_api_keys: null,
              api_requests_per_day: 10000,
              public_api_requests_per_hour: null,
              max_members: 25,
            },
          },
        },
      },
    });

    render(<OrganizationWorkspacePageView controller={controller} />);

    expect(screen.getByRole("heading", { level: 2, name: "Package access" })).toBeInTheDocument();
    expect(screen.getByText("Atlas Field Intelligence")).toBeInTheDocument();
    expect(screen.getByText("25 members")).toBeInTheDocument();
    expect(screen.getByText("10,000 API requests/day")).toBeInTheDocument();
    expect(screen.getByText("Exports")).toBeInTheDocument();
    expect(screen.getByText("Monitoring")).toBeInTheDocument();
    expect(screen.getByText("Coverage targets")).toBeInTheDocument();
    expect(screen.getByText("SSO")).toBeInTheDocument();
    expect(screen.getByText("Not included")).toBeInTheDocument();
  });

  it("shows renewal proof to workspace admins", () => {
    const controller = buildController({
      usageSummary: {
        event_counts: { brief_opened: 2 },
        org_id: "org_1",
        renewal_signals: {
          briefs_used: 2,
          coverage_gaps_closed: 1,
          integrations_used: 0,
          public_records_improved: 3,
          team_workflow_actions: 4,
        },
        total_events: 10,
      },
      usageAuditLog: {
        data_boundary: {
          metadata_included: false,
          session_replay_included: false,
          statement:
            "The audit log shows timestamped workspace usage events without private metadata or behavioral session replay.",
        },
        items: [
          {
            actor_id: "user_1",
            created_at: "2026-07-03T12:00:00.000Z",
            event_type: "api_call",
            id: "event_1",
            org_id: "org_1",
            resource_id: "GET /api/profiles/{slug}",
            resource_type: "api",
          },
        ],
        limit: 10,
        offset: 0,
        org_id: "org_1",
        total: 1,
      },
      integrationMonitoring: {
        api_calls: 2,
        data_boundary: {
          request_metadata_included: false,
          session_replay_included: false,
          statement:
            "Workspace integration activity records counts, surfaces, paths, and last-seen times without request metadata or behavioral session replay.",
        },
        last_seen_at: "2026-07-03T12:00:00.000Z",
        mcp_calls: 1,
        org_id: "org_1",
        top_resources: [
          {
            last_seen_at: "2026-07-03T12:00:00.000Z",
            resource_id: "/mcp",
            surface: "mcp",
            total_calls: 1,
          },
        ],
        total_calls: 3,
      },
    });

    render(<OrganizationWorkspacePageView controller={controller} />);

    expect(screen.getByRole("heading", { level: 2, name: "Renewal proof" })).toBeInTheDocument();
    expect(screen.getByText("Public records improved")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Access log" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 3, name: "Workspace integration activity" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download packet" })).toHaveAttribute(
      "href",
      "/api/orgs/org_1/usage-summary/renewal-packet?format=markdown",
    );
  });

  it("hides renewal proof from workspaces the operator cannot manage", () => {
    const controller = buildController({
      canManageOrganization: false,
      usageSummary: {
        event_counts: { brief_opened: 2 },
        org_id: "org_1",
        renewal_signals: {
          briefs_used: 2,
          coverage_gaps_closed: 1,
          integrations_used: 0,
          public_records_improved: 3,
          team_workflow_actions: 4,
        },
        total_events: 10,
      },
    });

    render(<OrganizationWorkspacePageView controller={controller} />);

    expect(
      screen.queryByRole("heading", { level: 2, name: "Renewal proof" }),
    ).not.toBeInTheDocument();
  });

  it("forwards resend requests from the invitations section to the controller", () => {
    const onResendInvitation = vi.fn();
    const controller = buildController({
      onResendInvitation,
      organization: {
        id: "org_1",
        name: "Atlas",
        slug: "atlas",
        members: [],
        invitations: [
          {
            id: "inv_1",
            email: "pending@atlas.test",
            role: "member",
            status: "pending",
            createdAt: "2026-04-01T00:00:00.000Z",
            expiresAt: "2026-05-01T00:00:00.000Z",
          },
        ],
        metadata: { workspaceType: "team" },
        capabilities: { canUseTeamFeatures: true },
        role: "owner",
        workspaceType: "team",
        sso: { providers: [] },
      },
      pendingInvitationMutationPending: false,
    });

    render(<OrganizationWorkspacePageView controller={controller} />);
    fireEvent.click(screen.getByRole("button", { name: "Resend" }));
    expect(onResendInvitation).toHaveBeenCalledWith("pending@atlas.test", "member");
  });
});
