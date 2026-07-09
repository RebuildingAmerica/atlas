import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ATLAS_COUPONS,
  ATLAS_PRODUCTS,
  STRIPE_BILLING_WEBHOOK_EVENTS,
} from "./products.js";

void describe("Stripe Atlas product catalog", () => {
  void it("contains only the product objects Atlas sells directly", () => {
    assert.deepEqual(
      ATLAS_PRODUCTS.map((product) => product.id),
      ["research-pass", "pro", "team-base", "team-seat"],
    );
    const pro = ATLAS_PRODUCTS.find((product) => product.id === "pro");
    assert.deepEqual(
      pro?.prices.map((price) => price.id),
      ["pro-monthly", "pro-yearly", "pro-student-four-month"],
    );
  });

  void it("models advertised discounts as coupons instead of alternate products", () => {
    assert.deepEqual(
      ATLAS_COUPONS.map((coupon) => coupon.segment),
      [
        "student",
        "independent_journalist",
        "grassroots_nonprofit",
        "civic_tech_worker",
      ],
    );
    assert.deepEqual(
      ATLAS_COUPONS.map((coupon) => coupon.envKey),
      [
        "STRIPE_COUPON_STUDENT",
        "STRIPE_COUPON_JOURNALIST",
        "STRIPE_COUPON_NONPROFIT",
        "STRIPE_COUPON_CIVIC_TECH",
      ],
    );
    const student = ATLAS_COUPONS.find(
      (coupon) => coupon.segment === "student",
    );
    assert.equal(student?.id, "atlas-pro-student-20");
    assert.equal(student?.percentOff, 20);
    assert.deepEqual(
      ATLAS_COUPONS.map((coupon) => coupon.appliesToProductIds),
      [["pro"], ["pro"], ["pro"], ["pro"]],
    );
  });

  void it("keeps student and journalist discounts aligned with pricing policy", () => {
    const pro = ATLAS_PRODUCTS.find((product) => product.id === "pro");
    const annual = pro?.prices.find((price) => price.id === "pro-yearly");
    const studentFourMonth = pro?.prices.find(
      (price) => price.id === "pro-student-four-month",
    );
    const studentCoupon = ATLAS_COUPONS.find(
      (coupon) => coupon.segment === "student",
    );
    const journalistCoupon = ATLAS_COUPONS.find(
      (coupon) => coupon.segment === "independent_journalist",
    );

    assert.equal(annual?.unitAmountCents, 4800);
    assert.equal(studentFourMonth?.unitAmountCents, 1600);
    assert.equal(studentFourMonth?.recurring?.interval, "month");
    assert.equal(studentFourMonth?.recurring?.intervalCount, 4);
    assert.equal(studentCoupon?.percentOff, 20);
    assert.equal(
      Math.round(
        (studentFourMonth?.unitAmountCents ?? 0) *
          (1 - (studentCoupon?.percentOff ?? 0) / 100),
      ),
      1280,
    );
    assert.equal(Math.round(((annual?.unitAmountCents ?? 0) * 0.8) / 3), 1280);
    assert.equal(journalistCoupon?.percentOff, 50);
    assert.deepEqual(journalistCoupon?.appliesToProductIds, ["pro"]);
  });

  void it("registers the webhook events the app webhook handler consumes", () => {
    assert.deepEqual(STRIPE_BILLING_WEBHOOK_EVENTS, [
      "checkout.session.completed",
      "customer.subscription.created",
      "customer.subscription.updated",
      "customer.subscription.deleted",
    ]);
  });
});
