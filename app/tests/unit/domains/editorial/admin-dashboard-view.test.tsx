// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AdminDashboardView } from "@/domains/editorial/admin-dashboard-view";
import type { AdminDashboardSummary } from "@/domains/editorial/admin-dashboard.functions";

describe("AdminDashboardView", () => {
  function summary(overrides: Partial<AdminDashboardSummary> = {}): AdminDashboardSummary {
    return {
      api: { status: "ok" },
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

  it("reads a healthy instance and links to its editorial queues", () => {
    render(<AdminDashboardView summary={summary()} />);

    expect(screen.getByText("Healthy")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review discovered profiles" })).toHaveAttribute(
      "href",
      "/editorial/discovery-reviews",
    );
    expect(screen.getByRole("link", { name: "Review visitor corrections" })).toHaveAttribute(
      "href",
      "/editorial/corrections",
    );
  });

  it("calls out a degraded API rather than a healthy one", () => {
    render(<AdminDashboardView summary={summary({ api: { status: "degraded" } })} />);

    expect(screen.getByText("Degraded")).toBeInTheDocument();
    expect(screen.queryByText("Healthy")).not.toBeInTheDocument();
  });

  it("leaves platform work to the platform admin", () => {
    render(<AdminDashboardView summary={summary()} />);

    expect(screen.queryByRole("link", { name: "Review discounts" })).not.toBeInTheDocument();
    expect(screen.queryByText(/cloud costs/i)).not.toBeInTheDocument();
  });
});
