import { describe, expect, it } from "vitest";
import { paidPlanAction } from "@/domains/waitlist/pricing-access";
import type { PaidAccessDecision } from "@/domains/waitlist/contracts";
describe("paid plan actions", () => {
  const waiting: PaidAccessDecision = { mode: "waitlist", admittedProducts: [], requests: [] };

  it("offers waitlist signup even while sales are paused", () => {
    expect(paidPlanAction(waiting, "atlas_pro", false, [])).toEqual({
      kind: "join",
      label: "Join waitlist",
      disabled: false,
    });
  });
  it("permits admitted buyers only while checkout is open", () => {
    const access = { ...waiting, admittedProducts: ["atlas_pro" as const] };
    expect(paidPlanAction(access, "atlas_pro", true, []).kind).toBe("purchase");
    expect(paidPlanAction(access, "atlas_pro", false, []).disabled).toBe(true);
    expect(paidPlanAction(access, "atlas_team", true, []).kind).toBe("join");
  });
  it("preserves paid customers and never treats unknown admission as permission", () => {
    expect(paidPlanAction(waiting, "atlas_pro", false, ["atlas_pro"]).kind).toBe("account");
    expect(paidPlanAction(undefined, "atlas_pro", true, []).disabled).toBe(true);
    expect(paidPlanAction({ ...waiting, mode: "open" }, "atlas_pro", true, []).kind).toBe(
      "purchase",
    );
  });
  it("routes existing requests privately and names the selected pass duration", () => {
    const request = { id: "private", product: "atlas_pro" };
    expect(
      paidPlanAction(
        { ...waiting, requests: [request] as PaidAccessDecision["requests"] },
        "atlas_pro",
        true,
        [],
      ),
    ).toMatchObject({ kind: "request", requestId: "private" });
    for (const interval of ["weekly", "once"])
      expect(
        paidPlanAction({ ...waiting, mode: "open" }, "atlas_research_pass", true, [], interval)
          .label,
      ).toContain(interval === "weekly" ? "7-day" : "30-day");
  });
});
