// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/../tests/helpers/render-with-providers";

const mocks = vi.hoisted(() => ({
  loadCloudCostPosture: vi.fn(),
  useHydrated: vi.fn(() => true),
}));

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/admin/cloud-costs.functions", () => ({
  loadCloudCostPosture: mocks.loadCloudCostPosture,
}));

vi.mock("@/platform/runtime/use-hydrated", () => ({
  useHydrated: mocks.useHydrated,
}));

describe("routes/_workspace/admin/cloud-costs", () => {
  afterEach(() => {
    cleanup();
    mocks.loadCloudCostPosture.mockReset();
  });

  it("puts the cloud-cost posture page behind the workspace admin route", async () => {
    mocks.loadCloudCostPosture.mockResolvedValue({
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
      ],
      posture: "warn",
    });

    const routeModule = await import("@/routes/_workspace/admin/cloud-costs");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Component = asRouteStub(routeModule.Route).options.component;
    if (!Component) throw new Error("Expected Route.options.component");

    renderWithProviders(<Component />);

    expect(await screen.findByRole("heading", { name: "Cloud costs" })).toBeInTheDocument();
    expect(await screen.findByText("$2.75")).toBeInTheDocument();
    expect(screen.getByText("Artifact Registry cleanup")).toBeInTheDocument();
  });
});
