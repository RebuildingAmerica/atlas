// @vitest-environment jsdom
/* eslint-disable atlas-tests/no-test-file-locals */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudCostsAdminPage } from "@/domains/admin/cloud-costs-page";
import type { CloudCostPostureResponse } from "@/domains/admin/cloud-costs.functions";

const mocks = vi.hoisted(() => ({
  loadCloudCostPosture: vi.fn(),
}));

vi.mock("@/domains/admin/cloud-costs.functions", () => ({
  loadCloudCostPosture: mocks.loadCloudCostPosture,
}));

const postureResponse: CloudCostPostureResponse = {
  billing_export: {
    detail: "Cloud Billing BigQuery export is not connected yet.",
    status: "not_connected",
  },
  discovery_spend: {
    daily_ceiling_usd: 10,
    estimated_daily_usd: 2.75,
    kill_switch_enabled: false,
    posture: "pass",
    run_ceiling_usd: 5,
  },
  external_fixed_costs: {
    detail: "External provider fixed costs are not configured yet.",
    status: "not_configured",
  },
  generated_at: "2026-07-12T07:00:00Z",
  guardrails: [
    {
      detail: "Deploy preflight applies and verifies Docker image cleanup before building.",
      id: "artifact-registry-cleanup",
      label: "Artifact Registry cleanup",
      posture: "pass",
    },
    {
      detail: "Cloud Billing BigQuery export is not connected yet.",
      id: "cloud-billing-export",
      label: "Cloud Billing export",
      posture: "warn",
    },
  ],
  posture: "warn",
};

function renderCloudCostsAdminPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <CloudCostsAdminPage />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  mocks.loadCloudCostPosture.mockReset();
});

describe("CloudCostsAdminPage", () => {
  it("renders cloud cost posture from the authenticated server function", async () => {
    mocks.loadCloudCostPosture.mockResolvedValue(postureResponse);

    renderCloudCostsAdminPage();

    expect(await screen.findByRole("heading", { name: "Cloud costs" })).toBeInTheDocument();
    expect(screen.getByText("$2.75")).toBeInTheDocument();
    expect(screen.getByText("$10.00 daily ceiling")).toBeInTheDocument();
    expect(screen.getByText("Artifact Registry cleanup")).toBeInTheDocument();
    expect(screen.getAllByText("Cloud Billing BigQuery export is not connected yet.")).toHaveLength(
      2,
    );
    expect(
      screen.getByText("External provider fixed costs are not configured yet."),
    ).toBeInTheDocument();
    expect(mocks.loadCloudCostPosture).toHaveBeenCalledWith();
  });
});
