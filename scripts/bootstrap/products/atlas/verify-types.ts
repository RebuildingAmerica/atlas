/** The shapes Stripe catalog verification reads and reports. */

import type Stripe from "stripe";

export type StripeCatalogIssueCode =
  | "missing_env"
  | "invalid_catalog"
  | "missing_product"
  | "product_id_mismatch"
  | "product_inactive"
  | "product_metadata_mismatch"
  | "missing_price"
  | "price_id_mismatch"
  | "price_inactive"
  | "price_product_mismatch"
  | "price_amount_mismatch"
  | "price_currency_mismatch"
  | "price_recurring_mismatch"
  | "price_metadata_mismatch"
  | "missing_coupon"
  | "coupon_id_mismatch"
  | "coupon_percent_mismatch"
  | "coupon_duration_mismatch"
  | "coupon_product_scope_mismatch"
  | "coupon_metadata_mismatch"
  | "webhook_url_invalid"
  | "missing_webhook_endpoint"
  | "webhook_disabled"
  | "webhook_events_mismatch"
  | "webhook_metadata_mismatch"
  | "missing_hosted_env"
  | "vercel_project_unlinked";

export interface StripeCatalogVerificationIssue {
  code: StripeCatalogIssueCode;
  envKey: string;
  message: string;
}

export interface StripeProductSnapshot {
  active: boolean;
  envKey: string;
  id: string;
  metadata: Stripe.Metadata;
  name: string;
}

export interface StripePriceSnapshot {
  active: boolean;
  currency: string;
  envKey: string;
  id: string;
  metadata: Stripe.Metadata;
  productId: string;
  recurringInterval: string | null;
  recurringIntervalCount: number | null;
  unitAmount: number | null;
}

export interface StripeCouponSnapshot {
  appliesToProductIds: readonly string[];
  duration: string;
  envKey: string;
  id: string;
  metadata: Stripe.Metadata;
  percentOff: number | null;
}

export interface StripeWebhookEndpointSnapshot {
  enabledEvents: readonly string[];
  id: string;
  metadata: Stripe.Metadata;
  status: string;
  url: string;
}

export interface StripeCatalogSnapshot {
  coupons: Map<string, StripeCouponSnapshot>;
  prices: Map<string, StripePriceSnapshot>;
  products: Map<string, StripeProductSnapshot>;
  webhookEndpoints: Map<string, StripeWebhookEndpointSnapshot>;
}

export interface StripeCatalogVerificationOptions {
  expectedWebhookUrl?: string;
  requireWebhookSecret?: boolean;
}
