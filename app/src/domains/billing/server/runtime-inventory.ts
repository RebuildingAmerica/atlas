import "@tanstack/react-start/server-only";

import type Stripe from "stripe";
import { parseStripeAtlasCatalog } from "../products";
import type { StripeAtlasCatalog } from "../products";

export interface RuntimeBillingCheck {
  name: string;
  status: "pass" | "fail" | "unverified";
  /** Fixed diagnostic codes only. Never include Stripe values or provider error text. */
  reasonCodes?: string[];
}

const REQUIRED_WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "refund.created",
  "refund.updated",
] as const;

function diagnosticCheck(
  name: string,
  status: RuntimeBillingCheck["status"],
  reasonCodes: string[],
): RuntimeBillingCheck {
  return reasonCodes.length > 0 ? { name, status, reasonCodes } : { name, status };
}

function parentForPrice(
  key: keyof StripeAtlasCatalog["prices"],
  products: StripeAtlasCatalog["products"],
): string {
  if (key.startsWith("research-pass-")) return products["research-pass"];
  if (key.startsWith("team-base-")) return products["team-base"];
  if (key.startsWith("team-seat-")) return products["team-seat"];
  return products.pro;
}

async function inspectCatalog(
  stripe: Stripe,
  rawCatalog: string | undefined,
): Promise<RuntimeBillingCheck> {
  let catalog: StripeAtlasCatalog;
  try {
    catalog = parseStripeAtlasCatalog(rawCatalog?.trim() ?? "");
  } catch {
    return { name: "Catalog IDs", status: "fail" };
  }

  try {
    const productIds = Object.values(catalog.products) as string[];
    const priceEntries = Object.entries(catalog.prices) as [
      keyof StripeAtlasCatalog["prices"],
      string,
    ][];
    const couponIds = Object.values(catalog.coupons) as string[];
    const products = await Promise.all(productIds.map((id) => stripe.products.retrieve(id)));
    const prices = await Promise.all(
      priceEntries.map(async ([key, id]) => ({ key, id, price: await stripe.prices.retrieve(id) })),
    );
    const coupons = await Promise.all(couponIds.map((id) => stripe.coupons.retrieve(id)));
    const productReady = products.every(
      (product, index) => product.id === productIds[index] && !product.deleted && product.active,
    );
    const priceReady = prices.every(
      ({ key, id, price }) =>
        price.id === id &&
        price.active &&
        price.currency === "usd" &&
        (typeof price.product === "string" ? price.product : price.product.id) ===
          parentForPrice(key, catalog.products),
    );
    const couponsReady = coupons.every((coupon) => !coupon.deleted && coupon.valid);
    return {
      name: "Catalog IDs",
      status: productReady && priceReady && couponsReady ? "pass" : "fail",
    };
  } catch {
    return { name: "Catalog IDs", status: "unverified" };
  }
}

async function inspectWebhook(
  stripe: Stripe,
  env: NodeJS.ProcessEnv,
): Promise<RuntimeBillingCheck> {
  const secret = env.STRIPE_WEBHOOK_SECRET?.trim() ?? "";
  const reasonCodes: string[] = [];
  let endpointUrl: string | undefined;
  try {
    endpointUrl = new URL("/api/stripe/webhook", env.ATLAS_PUBLIC_URL).toString();
  } catch {
    reasonCodes.push("webhook_public_url_invalid");
  }
  if (!secret.startsWith("whsec_")) {
    reasonCodes.push("webhook_signing_secret_missing");
  }
  if (reasonCodes.length > 0) {
    return diagnosticCheck("Webhook endpoint metadata", "fail", reasonCodes);
  }
  try {
    const result = await stripe.webhookEndpoints.list({ limit: 100 });
    const endpoint = result.data.find((item) => item.url === endpointUrl);
    if (!endpoint) {
      return diagnosticCheck("Webhook endpoint metadata", result.has_more ? "unverified" : "fail", [
        result.has_more ? "webhook_list_incomplete" : "webhook_missing",
      ]);
    }
    if (endpoint.status !== "enabled") reasonCodes.push("webhook_disabled");
    if (endpoint.metadata?.atlas_webhook !== "billing") {
      reasonCodes.push("webhook_metadata_missing");
    }
    for (const event of REQUIRED_WEBHOOK_EVENTS) {
      if (!endpoint.enabled_events.includes(event)) {
        reasonCodes.push(`webhook_event_missing:${event}`);
      }
    }
    return diagnosticCheck(
      "Webhook endpoint metadata",
      reasonCodes.length === 0 ? "pass" : "fail",
      reasonCodes,
    );
  } catch {
    return diagnosticCheck("Webhook endpoint metadata", "unverified", ["webhook_unreadable"]);
  }
}

/** Inspect the deployed Stripe account without returning credentials or provider errors. */
export async function inspectRuntimeBilling(
  stripe: Stripe,
  env: NodeJS.ProcessEnv,
): Promise<RuntimeBillingCheck[]> {
  const key = env.STRIPE_API_KEY?.trim() ?? "";
  if (!/^(sk|rk)_live_/.test(key)) {
    return [{ name: "Runtime key", status: "fail" }];
  }

  const checks: RuntimeBillingCheck[] = [{ name: "Runtime key", status: "pass" }];
  const portalId = env.STRIPE_BILLING_PORTAL_CONFIGURATION?.trim();
  const results = await Promise.allSettled([
    stripe.accounts.retrieveCurrent(),
    stripe.tax.settings.retrieve(),
    portalId
      ? stripe.billingPortal.configurations.retrieve(portalId)
      : Promise.reject(new Error("Portal configuration not set.")),
  ]);

  const account = results[0];
  checks.push({
    name: "Charge-enabled account",
    status:
      account.status === "rejected"
        ? "unverified"
        : account.value.charges_enabled
          ? "pass"
          : "fail",
  });

  const tax = results[1];
  checks.push({
    name: "Stripe Tax",
    status:
      tax.status === "rejected"
        ? "unverified"
        : tax.value.livemode && tax.value.status === "active"
          ? "pass"
          : "fail",
  });

  const portal = results[2];
  const portalReasons: string[] = [];
  if (!portalId) {
    portalReasons.push("portal_configuration_missing");
  } else if (portal.status === "rejected") {
    portalReasons.push("portal_unreadable");
  } else {
    const configuration = portal.value;
    if (configuration.id !== portalId || configuration.metadata?.atlas_portal !== "billing") {
      portalReasons.push("portal_metadata_mismatch");
    }
    if (!configuration.active) portalReasons.push("portal_inactive");
    if (!configuration.livemode) portalReasons.push("portal_not_live");
    if (!configuration.features.invoice_history.enabled) {
      portalReasons.push("portal_invoice_history_disabled");
    }
    if (!configuration.features.payment_method_update.enabled) {
      portalReasons.push("portal_payment_update_disabled");
    }
    if (!configuration.features.subscription_cancel.enabled) {
      portalReasons.push("portal_cancellation_disabled");
    }
    if (configuration.features.subscription_cancel.mode !== "at_period_end") {
      portalReasons.push("portal_cancellation_mode_wrong");
    }
    if (configuration.features.subscription_update?.enabled) {
      portalReasons.push("portal_plan_change_enabled");
    }
  }
  checks.push(
    diagnosticCheck(
      "Customer portal",
      !portalId
        ? "fail"
        : portal.status === "rejected"
          ? "unverified"
          : portalReasons.length === 0
            ? "pass"
            : "fail",
      portalReasons,
    ),
  );

  const [catalog, webhook] = await Promise.all([
    inspectCatalog(stripe, env.STRIPE_ATLAS_CATALOG),
    inspectWebhook(stripe, env),
  ]);
  checks.push(catalog, webhook);

  return checks;
}
