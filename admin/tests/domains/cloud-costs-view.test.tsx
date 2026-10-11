// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CloudCostsView } from "@/domains/cloud-costs/cloud-costs-view";
import type { CloudCostPostureResponse } from "@/generated/platform-schemas";

describe("CloudCostsView", () => {
  function blockedPosture(): CloudCostPostureResponse {
    return {
      billing_export: {
        detail: "Cloud Billing BigQuery export streams into the ledger.",
        status: "connected",
      },
      discovery_spend: {
        daily_ceiling_usd: 10,
        estimated_daily_usd: 12.5,
        kill_switch_enabled: true,
        posture: "block",
        run_ceiling_usd: 5,
      },
      external_fixed_costs: {
        detail: "External provider fixed costs are tracked outside Atlas.",
        status: "not_connected",
      },
      generated_at: "2026-07-12T07:00:00Z",
      guardrails: [
        {
          detail: "Discovery spend passed the daily ceiling.",
          id: "daily-ceiling",
          label: "Daily ceiling",
          posture: "block",
        },
      ],
      posture: "block",
    };
  }

  it("says the discovery budget is blocked and the kill switch is on", () => {
    render(<CloudCostsView posture={blockedPosture()} />);

    expect(screen.getAllByText("Blocked").length).toBeGreaterThan(0);
    expect(screen.getByText("$12.50")).toBeInTheDocument();
    expect(screen.getByText("$375.00")).toBeInTheDocument();
    expect(screen.getByText("Kill switch enabled")).toBeInTheDocument();
    expect(screen.getByText("Daily ceiling")).toBeInTheDocument();
    expect(
      screen.getByText("Discovery spend passed the daily ceiling."),
    ).toBeInTheDocument();
  });

  it("distinguishes a connected billing export from an unconnected one", () => {
    render(<CloudCostsView posture={blockedPosture()} />);

    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByText("Not connected")).toBeInTheDocument();
    expect(screen.queryByText("Not configured")).not.toBeInTheDocument();
  });

  it("flags guardrails that need attention apart from those that pass", () => {
    const posture: CloudCostPostureResponse = {
      ...blockedPosture(),
      discovery_spend: {
        ...blockedPosture().discovery_spend,
        kill_switch_enabled: false,
        posture: "warn",
      },
      external_fixed_costs: {
        detail: "Not tracked yet.",
        status: "not_configured",
      },
      guardrails: [
        {
          detail: "Spend is near the ceiling.",
          id: "near",
          label: "Near ceiling",
          posture: "warn",
        },
        {
          detail: "Scales to zero.",
          id: "zero",
          label: "Scale to zero",
          posture: "pass",
        },
      ],
      posture: "warn",
    };
    const { container } = render(<CloudCostsView posture={posture} />);

    expect(screen.getAllByText("Needs attention").length).toBeGreaterThan(1);
    expect(screen.getByText("Pass")).toBeInTheDocument();
    expect(screen.getByText("Not configured")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(container.querySelector(".text-yellow-600")).toBeInTheDocument();
    expect(container.querySelector(".text-emerald-600")).toBeInTheDocument();
  });

  it("shows placeholders and the reason when the posture is unavailable", () => {
    render(
      <CloudCostsView
        errorMessage="Cloud costs could not load."
        isLoading={false}
      />,
    );

    expect(screen.getByText("Status unavailable")).toBeInTheDocument();
    expect(screen.getByText("Cloud costs could not load.")).toBeInTheDocument();
    // Three empty values, plus the per-run ceiling's empty detail.
    expect(screen.getAllByText("-")).toHaveLength(4);
  });
});
