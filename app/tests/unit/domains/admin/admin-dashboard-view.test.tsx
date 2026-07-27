// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AdminDashboardView } from "@/domains/admin/admin-dashboard-view";
import type { AdminDashboardSummary } from "@/domains/admin/admin-dashboard.functions";

describe("AdminDashboardView", () => {
  function summary(overrides: Partial<AdminDashboardSummary> = {}): AdminDashboardSummary {
    return {
      api: { status: "ok" },
      cloud_costs: {
        billing_export: {
          detail: "Cloud Billing BigQuery export is not connected yet.",
          status: "not_connected",
        },
        discovery_spend: {
          daily_ceiling_usd: 10,
          estimated_daily_usd: 2,
          kill_switch_enabled: false,
          posture: "pass",
          run_ceiling_usd: 5,
        },
        external_fixed_costs: {
          detail: "External provider fixed costs are not configured yet.",
          status: "not_configured",
        },
        generated_at: "2026-07-12T07:05:00Z",
        guardrails: [],
        posture: "pass",
      },
      discovery: {
        completed_runs_total: 9,
        enabled_schedules: 2,
        failed_jobs: 0,
        last_completed_run_at: "2026-07-12T07:00:00Z",
        queued_jobs: 0,
        running_jobs: 1,
        total_entries_confirmed: 42,
      },
      ...overrides,
    };
  }

  it("reads a healthy service posture as current spend within budget", () => {
    render(<AdminDashboardView summary={summary()} />);

    expect(screen.getByText("Healthy")).toBeInTheDocument();
    expect(screen.getByText("$2.00 of $10.00")).toBeInTheDocument();
    expect(
      within(screen.getByRole("link", { name: "Inspect cloud costs" })).getByText("Current"),
    ).toBeInTheDocument();
  });

  it("calls out a degraded API and blocked spend rather than a healthy one", () => {
    const blocked = summary({ api: { status: "degraded" } });
    blocked.cloud_costs.posture = "block";

    render(<AdminDashboardView summary={blocked} />);

    expect(screen.getByText("Degraded")).toBeInTheDocument();
    expect(screen.queryByText("Healthy")).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("link", { name: "Inspect cloud costs" })).getByText("Blocked"),
    ).toBeInTheDocument();
  });
});
