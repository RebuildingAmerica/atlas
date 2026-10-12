import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type Stripe from "stripe";
import {
  ATLAS_PRODUCTS,
  ATLAS_COUPONS,
  STRIPE_BILLING_WEBHOOK_EVENTS,
} from "../bootstrap/config/products.js";
import { buildStripeEnvUpdates } from "../bootstrap/products/atlas/env.js";
import type { StripeCatalogSnapshot } from "../bootstrap/products/atlas/verify-types.js";
import {
  verifyPublicationBilling,
  type BillingDiagnostic,
} from "./publication-billing.js";

function fixture() {
  const ids = new Map<string, string>();
  for (const product of ATLAS_PRODUCTS) {
    ids.set(product.envProductKey, `prod_fixture_${product.id}`);
    for (const price of product.prices)
      ids.set(price.envKey, `price_fixture_${price.id}`);
  }
  for (const coupon of ATLAS_COUPONS) ids.set(coupon.envKey, coupon.id);
  const runtime = Object.fromEntries(
    buildStripeEnvUpdates(
      "rk_live_fixture_only",
      "whsec_fixture_only",
      ids,
      "bpc_fixture",
    ),
  );
  runtime.ATLAS_PUBLIC_URL = "https://atlas.example.org";
  runtime.ATLAS_BILLING_ALLOWED_OFFERS = "atlas_pro:monthly";
  const snapshot: StripeCatalogSnapshot = {
    products: new Map(
      ATLAS_PRODUCTS.map((product) => [
        product.envProductKey,
        {
          id: ids.get(product.envProductKey)!,
          envKey: product.envProductKey,
          active: true,
          name: product.stripeName,
          metadata: { atlas_product_id: product.id },
        },
      ]),
    ),
    prices: new Map(
      ATLAS_PRODUCTS.flatMap((product) =>
        product.prices.map(
          (price) =>
            [
              price.envKey,
              {
                id: ids.get(price.envKey)!,
                envKey: price.envKey,
                active: true,
                productId: ids.get(product.envProductKey)!,
                currency: price.currency,
                unitAmount: price.unitAmountCents,
                metadata: { atlas_price_id: price.id },
                recurringInterval: price.recurring?.interval ?? null,
                recurringIntervalCount: price.recurring
                  ? (price.recurring.intervalCount ?? 1)
                  : null,
              },
            ] as const,
        ),
      ),
    ),
    coupons: new Map(
      ATLAS_COUPONS.map((coupon) => [
        coupon.envKey,
        {
          id: coupon.id,
          envKey: coupon.envKey,
          duration: "forever",
          percentOff: coupon.percentOff,
          appliesToProductIds: [ids.get("STRIPE_PRODUCT_ATLAS_PRO")!],
          metadata: { atlas_discount_segment: coupon.segment },
        },
      ]),
    ),
    webhookEndpoints: new Map([
      [
        "https://atlas.example.org/api/stripe/webhook",
        {
          id: "we_fixture",
          url: "https://atlas.example.org/api/stripe/webhook",
          status: "enabled",
          enabledEvents: [...STRIPE_BILLING_WEBHOOK_EVENTS],
          metadata: { atlas_webhook: "billing" },
        },
      ],
    ]),
  };
  const portal = {
    id: "bpc_fixture",
    active: true,
    livemode: true,
    metadata: { atlas_portal: "billing" },
    features: {
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: { enabled: true, mode: "at_period_end" },
      subscription_update: { enabled: false },
    },
  };
  const calls: string[] = [];
  const stripe = {
    billingPortal: {
      configurations: {
        retrieve: async (id: string) => {
          calls.push(id);
          return portal;
        },
      },
    },
  } as unknown as Stripe;
  return { runtime, snapshot, portal, stripe, calls };
}

void test("the real billing CLI retains input failure when a key is missing", () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-billing-cli-"));
  try {
    const runtimeFile = join(directory, "runtime.json");
    const diagnostics = join(directory, "billing-diagnostics.jsonl");
    writeFileSync(
      runtimeFile,
      JSON.stringify({ ...fixture().runtime, STRIPE_API_KEY: "" }),
      { mode: 0o600 },
    );
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        fileURLToPath(new URL("./publication-billing.ts", import.meta.url)),
      ],
      {
        env: {
          ...process.env,
          ATLAS_WEB_RUNTIME_FILE: runtimeFile,
          ATLAS_PUBLICATION_BILLING_DIAGNOSTICS_FILE: diagnostics,
        },
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 1);
    assert.deepEqual(
      readFileSync(diagnostics, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as BillingDiagnostic),
      [
        { stage: "inputs", status: "running" },
        { stage: "inputs", status: "fail", failure: "validation" },
      ],
    );
    assert.doesNotMatch(
      `${result.stdout}${result.stderr}${readFileSync(diagnostics, "utf8")}`,
      /rk_live_fixture_only|whsec_fixture_only/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("billing retains a safe failing boundary without provider credentials or customer data", async () => {
  const f = fixture();
  const records: BillingDiagnostic[] = [];
  const failure = Object.assign(
    new Error("private-credential customer-private@example.org"),
    {
      type: "StripePermissionError",
    },
  );
  await assert.rejects(
    verifyPublicationBilling(
      f.runtime,
      f.stripe,
      async () => {
        throw failure;
      },
      (record) => records.push(record),
    ),
    (error) => error === failure,
  );
  assert.deepEqual(records, [
    { stage: "inputs", status: "running" },
    { stage: "inputs", status: "pass" },
    { stage: "catalog-read", status: "running" },
    { stage: "catalog-read", status: "fail", failure: "permission" },
  ]);
  assert.doesNotMatch(
    JSON.stringify(records),
    /private-credential|customer-private/,
  );
});

void test("billing records validation and portal failures as distinct boundaries", async () => {
  const f = fixture();
  const records: BillingDiagnostic[] = [];
  f.portal.features.subscription_update.enabled = true;
  await assert.rejects(
    verifyPublicationBilling(
      f.runtime,
      f.stripe,
      async () => f.snapshot,
      (record) => records.push(record),
    ),
    /portal/,
  );
  assert.deepEqual(records.at(-1), {
    stage: "portal-read",
    status: "fail",
    failure: "validation",
  });
  records.length = 0;
  await assert.rejects(
    verifyPublicationBilling(
      { ...f.runtime, STRIPE_API_KEY: "" },
      f.stripe,
      async () => f.snapshot,
      (record) => records.push(record),
    ),
    /STRIPE_API_KEY/,
  );
  assert.deepEqual(records, [
    { stage: "inputs", status: "running" },
    { stage: "inputs", status: "fail", failure: "validation" },
  ]);
});

void test("unknown provider failures cannot become diagnostic strings or validation claims", async () => {
  const f = fixture();
  const records: BillingDiagnostic[] = [];
  await assert.rejects(
    verifyPublicationBilling(
      f.runtime,
      f.stripe,
      async () => {
        throw { type: "private-provider-value", message: "private-credential" };
      },
      (record) => records.push(record),
    ),
  );
  assert.deepEqual(records.at(-1), {
    stage: "catalog-read",
    status: "fail",
    failure: "unknown",
  });
  assert.doesNotMatch(JSON.stringify(records), /private-/);
});

void test("successful billing reports every read-only boundary and portal read errors remain redacted", async () => {
  const f = fixture();
  const records: BillingDiagnostic[] = [];
  await verifyPublicationBilling(
    f.runtime,
    f.stripe,
    async () => f.snapshot,
    (record) => records.push(record),
  );
  assert.deepEqual(
    records,
    ["inputs", "catalog-read", "catalog-validation", "portal-read"].flatMap(
      (stage) => [
        { stage, status: "running" },
        { stage, status: "pass" },
      ],
    ),
  );
  records.length = 0;
  f.stripe.billingPortal.configurations.retrieve = async () => {
    throw new Error("private-customer-configuration");
  };
  await assert.rejects(
    verifyPublicationBilling(
      f.runtime,
      f.stripe,
      async () => f.snapshot,
      (record) => records.push(record),
    ),
    /portal/,
  );
  assert.deepEqual(records.slice(-2), [
    { stage: "portal-read", status: "running" },
    { stage: "portal-read", status: "fail", failure: "provider" },
  ]);
  assert.doesNotMatch(JSON.stringify(records), /private-customer/);
});

void test("publication verifies the retained live catalog, webhook and exact customer portal read-only", async () => {
  const f = fixture();
  await verifyPublicationBilling(
    f.runtime,
    f.stripe,
    async (_stripe, _env, webhook) => {
      assert.equal(webhook, "https://atlas.example.org/api/stripe/webhook");
      return f.snapshot;
    },
  );
  assert.deepEqual(f.calls, ["bpc_fixture"]);
  f.portal.features.subscription_update.enabled = true;
  await assert.rejects(
    verifyPublicationBilling(f.runtime, f.stripe, async () => f.snapshot),
    /portal/,
  );
});

void test("missing billing settings, test keys and wrong webhooks fail before a portal request", async () => {
  const f = fixture();
  await assert.rejects(
    verifyPublicationBilling(
      { ...f.runtime, STRIPE_WEBHOOK_SECRET: "" },
      f.stripe,
    ),
    /STRIPE_WEBHOOK_SECRET/,
  );
  await assert.rejects(
    verifyPublicationBilling(
      { ...f.runtime, STRIPE_API_KEY: "sk_test_fixture_only" },
      f.stripe,
    ),
  );
  f.snapshot.webhookEndpoints.clear();
  await assert.rejects(
    verifyPublicationBilling(f.runtime, f.stripe, async () => f.snapshot),
    /catalog or webhook/,
  );
  assert.deepEqual(f.calls, []);
});

void test("production publication rejects unrestricted keys before contacting Stripe", async () => {
  const f = fixture();
  let snapshotRequested = false;
  await assert.rejects(
    verifyPublicationBilling(
      { ...f.runtime, STRIPE_API_KEY: "sk_live_fixture_only" }, // pragma: allowlist secret
      f.stripe,
      async () => {
        snapshotRequested = true;
        return f.snapshot;
      },
    ),
    /restricted live key/,
  );
  assert.equal(snapshotRequested, false);
  assert.deepEqual(f.calls, []);
});

void test("explicitly closed checkout permits an empty offer list while retaining live billing checks", async () => {
  const f = fixture();
  f.runtime.ATLAS_BILLING_CHECKOUT_ENABLED = "false";
  f.runtime.ATLAS_BILLING_ALLOWED_OFFERS = "";
  await verifyPublicationBilling(f.runtime, f.stripe, async () => f.snapshot);
  assert.deepEqual(f.calls, ["bpc_fixture"]);
  f.portal.features.subscription_update.enabled = true;
  await assert.rejects(
    verifyPublicationBilling(f.runtime, f.stripe, async () => f.snapshot),
    /portal/,
  );
});

void test("an empty offer list cannot pass when checkout closure is missing or malformed", async () => {
  for (const flag of [undefined, "true", "off", ""]) {
    const f = fixture();
    f.runtime.ATLAS_BILLING_ALLOWED_OFFERS = "";
    if (flag !== undefined) f.runtime.ATLAS_BILLING_CHECKOUT_ENABLED = flag;
    await assert.rejects(
      verifyPublicationBilling(f.runtime, f.stripe, async () => f.snapshot),
      /ATLAS_BILLING_ALLOWED_OFFERS/,
    );
    assert.deepEqual(f.calls, []);
  }
});
