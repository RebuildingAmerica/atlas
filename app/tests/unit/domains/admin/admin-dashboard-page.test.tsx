// @vitest-environment jsdom
/* eslint-disable atlas-tests/no-test-file-locals */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminDashboardPage } from "@/domains/admin/admin-dashboard-page";
import type { AdminDashboardSummary } from "@/domains/admin/admin-dashboard.functions";

const mocks = vi.hoisted(() => ({
  useHydrated: vi.fn(() => true),
  loadAdminDashboardSummary: vi.fn(),
}));

vi.mock("@/domains/admin/admin-dashboard.functions", () => ({
  loadAdminDashboardSummary: mocks.loadAdminDashboardSummary,
}));

vi.mock("@/platform/runtime/use-hydrated", () => ({
  useHydrated: mocks.useHydrated,
}));

const dashboardSummary: AdminDashboardSummary = {
  api: { status: "ok" },
  discovery: {
    completed_runs_total: 9,
    enabled_schedules: 2,
    failed_jobs: 1,
    last_completed_run_at: "2026-07-12T07:00:00Z",
    queued_jobs: 4,
    running_jobs: 1,
    total_entries_confirmed: 42,
  },
};

function renderAdminDashboardPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <AdminDashboardPage />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  mocks.useHydrated.mockReset();
  mocks.useHydrated.mockReturnValue(true);
  mocks.loadAdminDashboardSummary.mockReset();
});

describe("AdminDashboardPage", () => {
  it("renders the admin shell while dashboard data is still loading", () => {
    mocks.loadAdminDashboardSummary.mockReturnValue(new Promise(() => undefined));

    renderAdminDashboardPage();

    expect(screen.getByRole("heading", { name: "Admin" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review profile verifications" })).toBeInTheDocument();
    expect(screen.getByText("API")).toBeInTheDocument();
    expect(screen.getAllByText("-").length).toBeGreaterThan(0);
    expect(screen.queryByText("Loading")).not.toBeInTheDocument();
  });

  it("keeps the admin shell visible when dashboard data fails", async () => {
    mocks.loadAdminDashboardSummary.mockRejectedValue(new Error("ATLAS_API_REQUEST_FAILED"));

    renderAdminDashboardPage();

    expect(screen.getByRole("heading", { name: "Admin" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review visitor corrections" })).toBeInTheDocument();
    expect(await screen.findByText("Admin status could not load.")).toBeInTheDocument();
    expect(screen.getAllByText("Admin status could not load.")).toHaveLength(1);
    expect(screen.queryByText("ATLAS_API_REQUEST_FAILED")).toBeNull();
  });

  it("renders service health indicators and links to detailed admin work", async () => {
    mocks.loadAdminDashboardSummary.mockResolvedValue(dashboardSummary);

    renderAdminDashboardPage();

    expect(await screen.findByRole("heading", { name: "Admin" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Service health" })).toBeInTheDocument();
    expect(await screen.findByText("4 queued")).toBeInTheDocument();
    expect(screen.getByText("API")).toBeInTheDocument();
    expect(screen.getByText("Discovery pipeline")).toBeInTheDocument();
    expect(screen.getByText("1 failed")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review profile verifications" })).toHaveAttribute(
      "href",
      "/admin/profile-claims",
    );
    expect(mocks.loadAdminDashboardSummary).toHaveBeenCalledWith();
  });

  it("shows safe copy when the request rejects with something other than an error", async () => {
    mocks.loadAdminDashboardSummary.mockRejectedValue("boom");

    renderAdminDashboardPage();

    expect(await screen.findByText("Admin status could not load.")).toBeInTheDocument();
  });

  it("shows safe copy when the request settles with nothing", async () => {
    mocks.loadAdminDashboardSummary.mockResolvedValue(null);

    renderAdminDashboardPage();

    expect(await screen.findByText("Admin status could not load.")).toBeInTheDocument();
  });
});
