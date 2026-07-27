// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CloudCostsView } from "@/domains/admin/cloud-costs-view";
import type { CloudCostPostureResponse } from "@/domains/admin/cloud-costs.functions";

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
    expect(screen.getByText("Discovery spend passed the daily ceiling.")).toBeInTheDocument();
  });

  it("distinguishes a connected billing export from an unconnected one", () => {
    render(<CloudCostsView posture={blockedPosture()} />);

    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByText("Not connected")).toBeInTheDocument();
    expect(screen.queryByText("Not configured")).not.toBeInTheDocument();
  });
});
