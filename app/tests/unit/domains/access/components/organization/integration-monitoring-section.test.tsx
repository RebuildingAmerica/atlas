// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { IntegrationMonitoringSection } from "@/domains/access/components/organization/integration-monitoring-section";
import {
  createIntegrationMonitoring,
  createIntegrationResource,
} from "./integration-monitoring-section-test-support";

describe("IntegrationMonitoringSection", () => {
  it("summarises how a workspace's integrations were used and when", () => {
    render(
      <IntegrationMonitoringSection
        integrationMonitoring={createIntegrationMonitoring({
          api_calls: 900,
          last_seen_at: "2026-07-03T12:00:00.000Z",
          mcp_calls: 1_600,
          top_resources: [
            createIntegrationResource({
              last_seen_at: "2026-07-03T12:00:00.000Z",
              resource_id: "GET /api/profiles/{slug}",
              surface: "api",
              total_calls: 42,
            }),
            createIntegrationResource({
              last_seen_at: "2026-07-03T11:00:00.000Z",
              resource_id: "atlas://entries/search",
              surface: "mcp",
              total_calls: 77,
            }),
          ],
          total_calls: 2_500,
        })}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Workspace integration activity" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/^Last seen /)).toBeInTheDocument();
    expect(screen.getByText("2,500")).toBeInTheDocument();
    expect(screen.getByText("900")).toBeInTheDocument();
    expect(screen.getByText("1,600")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("77")).toBeInTheDocument();
    expect(screen.getByText("GET /api/profiles/{slug}")).toBeInTheDocument();
    expect(screen.getByText("atlas://entries/search")).toBeInTheDocument();
    const resourceList = screen.getByRole("list");
    expect(within(resourceList).getByText("MCP")).toBeInTheDocument();
    expect(within(resourceList).getByText("REST API")).toBeInTheDocument();
  });

  it("says nothing has happened yet rather than showing an empty list", () => {
    render(
      <IntegrationMonitoringSection
        integrationMonitoring={createIntegrationMonitoring({ last_seen_at: null })}
      />,
    );

    expect(screen.getByText("No workspace integration activity yet.")).toBeInTheDocument();
    expect(screen.queryByText(/^Last seen /)).toBeNull();
    expect(screen.queryByText("Most used paths")).toBeNull();
  });

  it("promises admins that neither request metadata nor session replay is collected", () => {
    render(<IntegrationMonitoringSection integrationMonitoring={createIntegrationMonitoring()} />);

    expect(screen.getByText("No request metadata or session replay")).toBeInTheDocument();
  });

  it("narrows the promise to request metadata when session replay is collected", () => {
    render(
      <IntegrationMonitoringSection
        integrationMonitoring={createIntegrationMonitoring({
          data_boundary: {
            request_metadata_included: false,
            session_replay_included: true,
            statement: "Everything is recorded.",
          },
        })}
      />,
    );

    expect(screen.getByText("No request metadata")).toBeInTheDocument();
  });

  it("narrows the promise to session replay when request metadata is collected", () => {
    render(
      <IntegrationMonitoringSection
        integrationMonitoring={createIntegrationMonitoring({
          data_boundary: {
            request_metadata_included: true,
            session_replay_included: false,
            statement: "Everything is recorded.",
          },
        })}
      />,
    );

    expect(screen.getByText("No session replay")).toBeInTheDocument();
  });

  it("falls back to the API's own boundary statement when both are collected", () => {
    render(
      <IntegrationMonitoringSection
        integrationMonitoring={createIntegrationMonitoring({
          data_boundary: {
            request_metadata_included: true,
            session_replay_included: true,
            statement: "Request metadata and session replay are retained for 30 days.",
          },
        })}
      />,
    );

    expect(
      screen.getByText("Request metadata and session replay are retained for 30 days."),
    ).toBeInTheDocument();
  });

  it("does not invent a timestamp for a resource whose last use is unreadable", () => {
    render(
      <IntegrationMonitoringSection
        integrationMonitoring={createIntegrationMonitoring({
          top_resources: [createIntegrationResource({ last_seen_at: "not-a-timestamp" })],
        })}
      />,
    );

    expect(screen.getByText("Unknown time")).toBeInTheDocument();
  });
});
