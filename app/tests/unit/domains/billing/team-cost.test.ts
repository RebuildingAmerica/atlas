import { describe, expect, it } from "vitest";
import {
  ATLAS_TEAM_MAX_MEMBERS,
  computeTeamSeatCostSummary,
  describeSeatsUsed,
  formatUsdFromCents,
  intervalCadenceLabel,
} from "@/domains/billing/team-cost";

describe("computeTeamSeatCostSummary", () => {
  it("bills only the base price for a single-member team (monthly)", () => {
    expect(computeTeamSeatCostSummary(1, "monthly")).toEqual({
      interval: "monthly",
      seatsUsed: 1,
      maxSeats: ATLAS_TEAM_MAX_MEMBERS,
      additionalSeats: 0,
      baseCents: 2500,
      perSeatCents: 800,
      additionalSeatsCents: 0,
      totalCents: 2500,
    });
  });

  it("adds one billed seat per additional member (monthly)", () => {
    const summary = computeTeamSeatCostSummary(4, "monthly");
    expect(summary.additionalSeats).toBe(3);
    expect(summary.additionalSeatsCents).toBe(2400);
    expect(summary.totalCents).toBe(4900);
  });

  it("uses yearly base and seat amounts for the yearly interval", () => {
    const summary = computeTeamSeatCostSummary(3, "yearly");
    expect(summary.baseCents).toBe(25000);
    expect(summary.perSeatCents).toBe(8000);
    expect(summary.totalCents).toBe(25000 + 2 * 8000);
  });

  it("clamps a zero member count to zero billed seats", () => {
    const summary = computeTeamSeatCostSummary(0, "monthly");
    expect(summary.seatsUsed).toBe(0);
    expect(summary.additionalSeats).toBe(0);
    expect(summary.totalCents).toBe(2500);
  });

  it("clamps member counts above the plan ceiling", () => {
    const summary = computeTeamSeatCostSummary(60, "monthly");
    expect(summary.seatsUsed).toBe(ATLAS_TEAM_MAX_MEMBERS);
    expect(summary.additionalSeats).toBe(ATLAS_TEAM_MAX_MEMBERS - 1);
  });
});

describe("team-cost formatters", () => {
  it("formats whole-dollar cents without decimals", () => {
    expect(formatUsdFromCents(2500)).toBe("$25");
  });

  it("formats fractional-dollar cents with two decimals", () => {
    expect(formatUsdFromCents(2550)).toBe("$25.50");
  });

  it("labels the yearly cadence", () => {
    expect(intervalCadenceLabel("yearly")).toBe("per year");
  });

  it("labels the monthly cadence", () => {
    expect(intervalCadenceLabel("monthly")).toBe("per month");
  });

  it("describes seats used against the max", () => {
    expect(describeSeatsUsed(computeTeamSeatCostSummary(3, "monthly"))).toBe("3 of 50 seats used");
  });
});
