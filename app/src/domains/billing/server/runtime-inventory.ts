import "@tanstack/react-start/server-only";

import type Stripe from "stripe";
import { parseStripeAtlasCatalog } from "../products";
import type { StripeAtlasCatalog } from "../products";

export interface RuntimeBillingCheck {
  name: string;
  status: "pass" | "fail" | "unverified";
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
  let endpointUrl: string;
  try {
    endpointUrl = new URL("/api/stripe/webhook", env.ATLAS_PUBLIC_URL).toString();
  } catch {
    return { name: "Webhook endpoint metadata", status: "fail" };
  }
  if (!secret.startsWith("whsec_")) {
    return { name: "Webhook endpoint metadata", status: "fail" };
  }
  try {
    const result = await stripe.webhookEndpoints.list({ limit: 100 });
    const endpoint = result.data.find((item) => item.url === endpointUrl);
    if (!endpoint && result.has_more) {
      return { name: "Webhook endpoint metadata", status: "unverified" };
    }
    const ready =
      endpoint?.status === "enabled" &&
      REQUIRED_WEBHOOK_EVENTS.every((event) => endpoint.enabled_events.includes(event));
    return { name: "Webhook endpoint metadata", status: ready ? "pass" : "fail" };
  } catch {
    return { name: "Webhook endpoint metadata", status: "unverified" };
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
  const results = await Promise.allSettled([
    stripe.accounts.retrieveCurrent(),
    stripe.tax.settings.retrieve(),
    stripe.billingPortal.configurations.list({ is_default: true, limit: 1 }),
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
  const configuration = portal.status === "fulfilled" ? portal.value.data[0] : undefined;
  const portalReady = Boolean(
    configuration?.active &&
    configuration.livemode &&
    configuration.features.invoice_history.enabled &&
    configuration.features.payment_method_update.enabled &&
    configuration.features.subscription_cancel.enabled &&
    configuration.features.subscription_cancel.mode === "at_period_end",
  );
  checks.push({
    name: "Customer portal",
    status: portal.status === "rejected" ? "unverified" : portalReady ? "pass" : "fail",
  });

  const [catalog, webhook] = await Promise.all([
    inspectCatalog(stripe, env.STRIPE_ATLAS_CATALOG),
    inspectWebhook(stripe, env),
  ]);
  checks.push(catalog, webhook);

  return checks;
}
