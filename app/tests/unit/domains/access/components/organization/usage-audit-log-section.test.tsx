// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { UsageAuditLogSection } from "@/domains/access/components/organization/usage-audit-log-section";
import { createUsageAuditLog, createUsageEvent } from "./usage-audit-log-section-test-support";

describe("UsageAuditLogSection", () => {
  it("names the resource each usage event touched", () => {
    render(
      <UsageAuditLogSection
        auditLog={createUsageAuditLog({
          items: [
            createUsageEvent({
              created_at: "2026-07-03T12:00:00.000Z",
              event_type: "api_call",
              id: "event_1",
              resource_id: "GET /api/profiles/{slug}",
              resource_type: "api",
            }),
          ],
          total: 1,
        })}
      />,
    );

    expect(screen.getByRole("heading", { name: "Access log" })).toBeInTheDocument();
    expect(screen.getByText("Private metadata excluded")).toBeInTheDocument();
    expect(screen.getByText("GET /api/profiles/{slug}")).toBeInTheDocument();
  });

  it("falls back to the resource type when the event names no specific resource", () => {
    render(
      <UsageAuditLogSection
        auditLog={createUsageAuditLog({
          items: [
            createUsageEvent({
              event_type: "brief_opened",
              id: "event_2",
              resource_id: null,
              resource_type: "brief",
            }),
          ],
          total: 1,
        })}
      />,
    );

    expect(screen.getByText("Brief")).toBeInTheDocument();
  });

  it("attributes an event with no resource at all to the workspace", () => {
    render(
      <UsageAuditLogSection
        auditLog={createUsageAuditLog({
          items: [
            createUsageEvent({
              event_type: "member_invited",
              id: "event_3",
              resource_id: null,
              resource_type: null,
            }),
          ],
          total: 1,
        })}
      />,
    );

    expect(screen.getByText("Workspace")).toBeInTheDocument();
  });

  it("does not invent a timestamp it cannot read", () => {
    render(
      <UsageAuditLogSection
        auditLog={createUsageAuditLog({
          items: [createUsageEvent({ created_at: "not-a-timestamp", id: "event_4" })],
          total: 1,
        })}
      />,
    );

    expect(screen.getByText("Unknown time")).toBeInTheDocument();
  });

  it("says the log is empty rather than showing an empty list", () => {
    render(<UsageAuditLogSection auditLog={createUsageAuditLog()} />);

    expect(screen.getByText("No access-log events yet.")).toBeInTheDocument();
    expect(screen.queryByRole("list")).toBeNull();
  });
});
