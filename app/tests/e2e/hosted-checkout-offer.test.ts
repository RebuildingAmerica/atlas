import { describe, expect, it } from "vitest";
import { selectHostedCheckoutOffer } from "./hosted-checkout-offer";

describe("selectHostedCheckoutOffer", () => {
  it("proves Pro monthly whenever production sells it", () => {
    expect(selectHostedCheckoutOffer(["atlas_team:monthly", "atlas_pro:monthly"])).toEqual({
      product: "atlas_pro",
      interval: "monthly",
    });
  });

  it("falls back to another offer production actually sells", () => {
    expect(selectHostedCheckoutOffer(["atlas_pro:yearly", "atlas_team:monthly"])).toEqual({
      product: "atlas_pro",
      interval: "yearly",
    });
    expect(selectHostedCheckoutOffer(["atlas_pro:four_month", "atlas_team:yearly"])).toEqual({
      product: "atlas_team",
      interval: "yearly",
    });
  });

  it("refuses when the only offers need a verified discount the proof cannot hold", () => {
    expect(() => selectHostedCheckoutOffer(["atlas_pro:four_month"])).toThrow(
      /no offer this proof can open/,
    );
  });
});
