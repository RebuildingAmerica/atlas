/**
 * Checks that Stripe will deliver billing events to this deployment.
 *
 * The catalog can be perfect and billing still silently broken if the webhook
 * points at the wrong origin or listens for the wrong events.
 */

import { stripeWebhookUrlForOrigin } from "./env.js";
import { STRIPE_BILLING_WEBHOOK_EVENTS } from "../../config/products.js";
import type { StripeBootstrapTarget } from "./env.js";
import type {
  StripeCatalogSnapshot,
  StripeCatalogVerificationIssue,
} from "./verify-types.js";

import { issue, sameStringSet } from "./verify-issue.js";

export function expectedWebhookUrlForEnv(
  env: Map<string, string>,
  target: StripeBootstrapTarget,
  issues?: StripeCatalogVerificationIssue[],
): string | undefined {
  if (target === "local") {
    return undefined;
  }
  const origin = env.get("ATLAS_PUBLIC_URL")?.trim();
  if (!origin) {
    issues?.push(
      issue(
        "missing_env",
        "ATLAS_PUBLIC_URL",
        "ATLAS_PUBLIC_URL is required to verify the hosted Stripe webhook endpoint.",
      ),
    );
    return undefined;
  }
  try {
    return stripeWebhookUrlForOrigin(origin);
  } catch (error) {
    issues?.push(
      issue(
        "webhook_url_invalid",
        "ATLAS_PUBLIC_URL",
        error instanceof Error ? error.message : String(error),
      ),
    );
    return undefined;
  }
}

export function verifyBillingWebhook(
  snapshot: StripeCatalogSnapshot,
  expectedWebhookUrl: string | undefined,
  issues: StripeCatalogVerificationIssue[],
): void {
  if (!expectedWebhookUrl) {
    return;
  }

  const actual = snapshot.webhookEndpoints.get(expectedWebhookUrl);
  if (!actual) {
    issues.push(
      issue(
        "missing_webhook_endpoint",
        "STRIPE_WEBHOOK_SECRET",
        `No enabled Stripe billing webhook endpoint exists for ${expectedWebhookUrl}.`,
      ),
    );
    return;
  }

  if (actual.status === "disabled") {
    issues.push(
      issue(
        "webhook_disabled",
        "STRIPE_WEBHOOK_SECRET",
        `Stripe webhook endpoint ${actual.id} is disabled.`,
      ),
    );
  }

  if (!sameStringSet(actual.enabledEvents, STRIPE_BILLING_WEBHOOK_EVENTS)) {
    issues.push(
      issue(
        "webhook_events_mismatch",
        "STRIPE_WEBHOOK_SECRET",
        `Stripe webhook endpoint ${actual.id} must listen for ${STRIPE_BILLING_WEBHOOK_EVENTS.join(", ")}.`,
      ),
    );
  }

  if (actual.metadata.atlas_webhook !== "billing") {
    issues.push(
      issue(
        "webhook_metadata_mismatch",
        "STRIPE_WEBHOOK_SECRET",
        `Stripe webhook endpoint ${actual.id} is missing atlas_webhook=billing.`,
      ),
    );
  }
}
