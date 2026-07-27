import { describe, expect, it, vi } from "vitest";
import {
  checkoutKey,
  describeCheckoutCost,
  loadStartCheckout,
  readCheckoutErrorMessage,
} from "@/domains/billing/pages/public/pricing-page-helpers";
import { PRICING_CHECKOUT_INTERVALS } from "@/domains/billing/checkout-intervals";
import { ATLAS_TEAM_PRICING, formatUsdFromCents } from "@/domains/billing/team-cost";

vi.mock("@/domains/billing/checkout.functions", () => ({
  startCheckout: "start-checkout-server-fn",
}));

describe("readCheckoutErrorMessage", () => {
  it("shows the message an Error carries", () => {
    expect(readCheckoutErrorMessage(new Error("Atlas could not reach Stripe."))).toBe(
      "Atlas could not reach Stripe.",
    );
  });

  it("falls back to a retry prompt for an Error with no message", () => {
    expect(readCheckoutErrorMessage(new Error(""))).toBe(
      "Atlas could not start checkout. Try again.",
    );
  });

  it("falls back to a retry prompt for a thrown string", () => {
    expect(readCheckoutErrorMessage("boom")).toBe("Atlas could not start checkout. Try again.");
  });

  it("falls back to a retry prompt for null", () => {
    expect(readCheckoutErrorMessage(null)).toBe("Atlas could not start checkout. Try again.");
  });
});

describe("checkoutKey", () => {
  it("distinguishes the same product on two intervals", () => {
    expect(checkoutKey("atlas_pro", "monthly")).toBe("atlas_pro:monthly");
    expect(checkoutKey("atlas_pro", "yearly")).not.toBe(checkoutKey("atlas_pro", "monthly"));
  });

  it("distinguishes two products on the same interval", () => {
    expect(checkoutKey("atlas_pro", "monthly")).not.toBe(checkoutKey("atlas_team", "monthly"));
  });
});

describe("loadStartCheckout", () => {
  it("resolves the checkout server function", async () => {
    await expect(loadStartCheckout()).resolves.toBe("start-checkout-server-fn");
  });
});

describe("describeCheckoutCost", () => {
  describe("Atlas Pro", () => {
    it("quotes $5 billed monthly", () => {
      expect(describeCheckoutCost("atlas_pro", "monthly")).toEqual({
        priceLine: "$5 per month, billed monthly.",
        detailLine: "Cancel any time from the billing portal.",
      });
    });

    it("quotes $48 a year and states the equivalent monthly rate correctly", () => {
      const { priceLine } = describeCheckoutCost("atlas_pro", "yearly");

      expect(priceLine).toBe("$48 per year — about $4 per month.");
      expect(48 / 12).toBe(4);
    });

    it("quotes the student rate as three payments totalling 80% of the annual rate", () => {
      const { detailLine, priceLine } = describeCheckoutCost("atlas_pro", "four_month");

      expect(priceLine).toBe("$12.80 every four months after student verification.");
      expect(detailLine).toContain("80% of the annual Pro rate");
      expect(12.8 * 3).toBeCloseTo(48 * 0.8, 10);
    });

    it("quotes the monthly rate for an interval Pro does not sell", () => {
      expect(describeCheckoutCost("atlas_pro", "weekly")).toEqual(
        describeCheckoutCost("atlas_pro", "monthly"),
      );
    });
  });

  describe("Atlas Team", () => {
    it("quotes the monthly base and seat prices Stripe will actually bill", () => {
      const { priceLine } = describeCheckoutCost("atlas_team", "monthly");
      const { baseCents, perSeatCents } = ATLAS_TEAM_PRICING.monthly;

      expect(priceLine).toContain(`${formatUsdFromCents(baseCents)} per month base`);
      expect(priceLine).toContain(`${formatUsdFromCents(perSeatCents)} per additional seat`);
    });

    it("quotes the yearly base and seat prices Stripe will actually bill", () => {
      const { priceLine } = describeCheckoutCost("atlas_team", "yearly");
      const { baseCents, perSeatCents } = ATLAS_TEAM_PRICING.yearly;

      expect(priceLine).toContain(`${formatUsdFromCents(baseCents)} per year base`);
      expect(priceLine).toContain(`${formatUsdFromCents(perSeatCents)} per additional seat`);
    });

    it("states the 50-member ceiling on both intervals", () => {
      expect(describeCheckoutCost("atlas_team", "monthly").detailLine).toContain(
        "Up to 50 members",
      );
      expect(describeCheckoutCost("atlas_team", "yearly").detailLine).toContain("Up to 50 members");
    });

    it("quotes the monthly rate for an interval Team does not sell", () => {
      expect(describeCheckoutCost("atlas_team", "once")).toEqual(
        describeCheckoutCost("atlas_team", "monthly"),
      );
    });
  });

  describe("Research Pass", () => {
    it("quotes $4 for the seven-day pass", () => {
      expect(describeCheckoutCost("atlas_research_pass", "weekly")).toEqual({
        priceLine: "$4 for 7 days of access.",
        detailLine:
          "One-time charge — your shortlists and notes stay readable after the pass ends.",
      });
    });

    it("quotes $9 for the thirty-day pass", () => {
      expect(describeCheckoutCost("atlas_research_pass", "once").priceLine).toBe(
        "$9 for 30 days of access.",
      );
    });

    it("promises both passes are a one-time charge", () => {
      expect(describeCheckoutCost("atlas_research_pass", "weekly").detailLine).toContain(
        "One-time charge",
      );
      expect(describeCheckoutCost("atlas_research_pass", "once").detailLine).toContain(
        "One-time charge",
      );
    });

    it("quotes the thirty-day pass for an interval the pass does not sell", () => {
      expect(describeCheckoutCost("atlas_research_pass", "monthly").priceLine).toBe(
        "$9 for 30 days of access.",
      );
    });
  });

  it.each(["atlas_pro", "atlas_research_pass", "atlas_team"] as const)(
    "never leaves a visitor without a price or an explanation for %s",
    (product) => {
      for (const interval of PRICING_CHECKOUT_INTERVALS) {
        const preview = describeCheckoutCost(product, interval);

        expect(preview.priceLine).toMatch(/\$\d/);
        expect(preview.detailLine.length).toBeGreaterThan(0);
      }
    },
  );
});
