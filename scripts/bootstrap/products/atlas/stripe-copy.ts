/**
 * What bootstrap says to an operator about Stripe: prompts, guidance and
 * the explanation of a failed account check.
 *
 * All of it is pure string building, so the wording can be tested without a
 * Stripe account, a terminal or a network.
 */

import type Stripe from "stripe";
import { hasVercelEnvKey } from "../../lib/vercel-env.js";
import {
  STRIPE_ENV_KEYS,
  type StripeRuntimeMode,
  type StripeBootstrapTarget,
} from "./env.js";
import { setupCommandForTarget as repoSetupCommandForTarget } from "../../config/setup-manifest.js";
import type { VercelEnvKey } from "../../lib/vercel.js";

interface StripeAccountPrompt {
  accountId: string;
  accountName: string;
  mode: StripeRuntimeMode;
  target: StripeBootstrapTarget;
}

interface StripeMissingApiKeyGuidanceParams {
  apiKeyResolutionNotes: readonly string[];
  hostedEnvStatus: readonly string[];
  target: StripeBootstrapTarget;
}

interface StripeGuidanceNote {
  message: string;
  title: string;
}

interface StripeVerificationFailure {
  accountId?: string;
  canContinueWithoutAccountRead: boolean;
  message: string;
  summary: string;
  title: string;
}

type StripeAccountForDisplay = Pick<
  Stripe.Account,
  "business_profile" | "id" | "settings"
>;

export function stripeAccountDisplayName(
  account: StripeAccountForDisplay,
): string {
  return (
    account.settings?.dashboard?.display_name ??
    account.business_profile?.name ??
    account.id
  );
}

export function formatStripeAccountPrompt(
  account: StripeAccountPrompt,
): string {
  return [
    "Use this Stripe account?",
    "",
    `Account: ${account.accountName}`,
    `Stripe ID: ${account.accountId}`,
    `Mode: ${account.mode}`,
    `Target: ${account.target}`,
  ].join("\n");
}

export function setupCommandForTarget(target: StripeBootstrapTarget): string {
  const command = repoSetupCommandForTarget(target);
  if (target === "prod") {
    return `STRIPE_API_KEY=rk_live_... ${command} --yes`;
  }
  if (target === "staging") {
    return `${command} --yes`;
  }
  return command;
}

export function stripeLiveRestrictedKeySetupSteps(): string[] {
  return [
    "Open Stripe Dashboard and switch to Live mode for The Rebuilding America Project.",
    "Go to Stripe Dashboard > Developers > API keys > Restricted keys.",
    "Click Create restricted key and choose Powering an integration you built.",
    "Use this key for Atlas website and app code.",
    "Name the key Atlas Production Billing.",
    "Set permissions:",
    "Read: Accounts v2 (Basic Business Contact Information).",
    "Write: Products, Prices, Coupons, Customers, Checkout Sessions, Webhook Endpoints.",
    "Reveal the key once, copy the rk_live_ value, and keep it out of chat and committed files.",
    "Run `STRIPE_API_KEY=rk_live_... pnpm setup:prod --yes` from this repo.",
  ];
}

export function formatStripeApiKeyPromptMessage(
  envMode: StripeRuntimeMode,
): string {
  if (envMode === "live") {
    return "Paste the Stripe live mode API key";
  }

  return "Paste the Stripe test mode API key";
}

export function formatStripeApiKeyGuidanceNote(
  envMode: StripeRuntimeMode,
): StripeGuidanceNote {
  if (envMode === "live") {
    return {
      title: "Stripe live mode API key",
      message: [
        "Create a live restricted key for Atlas production billing:",
        "",
        "1. Open https://dashboard.stripe.com/apikeys.",
        "2. Switch to Live mode.",
        "3. Choose The Rebuilding America Project account.",
        "4. Open Restricted keys and click Create restricted key.",
        "5. Choose Powering an integration you built.",
        "6. Use this key for Atlas website and app code.",
        "7. Name the key Atlas Production Billing.",
        "8. Set permissions:",
        "   Read: Accounts v2 (Basic Business Contact Information).",
        "   Write: Products, Prices, Coupons, Customers, Checkout Sessions,",
        "   Webhook Endpoints.",
        "9. Reveal the key once and copy the rk_live_ value.",
        "",
        "Bootstrap will create or update the Atlas Stripe catalog, webhook,",
        "env files, and Vercel Production env vars after this.",
      ].join("\n"),
    };
  }

  return {
    title: "Stripe test mode API key",
    message: [
      "For local and staging, run `stripe login` first so bootstrap can use",
      "your Stripe CLI test key.",
      "",
      "If you paste a key manually, use sk_test_ or rk_test_.",
      "Leaving this blank skips Stripe product setup.",
    ].join("\n"),
  };
}

export function formatStripeWebhookUrlPromptMessage(
  target: Exclude<StripeBootstrapTarget, "local">,
): string {
  const label = target === "prod" ? "Production" : "Staging";
  return [
    `${label} Atlas app URL`,
    "",
    "Enter the public HTTPS origin for the deployed Atlas app.",
    `1. Open the ${label.toLowerCase()} Atlas deployment.`,
    "2. Copy only the origin, for example https://atlas.rebuildingus.org.",
    "3. Do not include /api/stripe/webhook; bootstrap appends that path.",
    "",
    "Stripe will send webhooks to <origin>/api/stripe/webhook.",
    "Bootstrap saves this as ATLAS_PUBLIC_URL and uses it to create the Stripe webhook endpoint.",
  ].join("\n");
}

export function formatStripeMissingApiKeyGuidance(
  params: StripeMissingApiKeyGuidanceParams,
): string[] {
  if (params.target === "prod") {
    return [
      "Production Stripe setup needs a live restricted key before bootstrap can change Stripe.",
      ...stripeLiveRestrictedKeySetupSteps(),
      ...params.apiKeyResolutionNotes,
      ...params.hostedEnvStatus,
    ];
  }

  return [
    "Set STRIPE_API_KEY in .env or run `stripe login`.",
    ...params.apiKeyResolutionNotes,
    ...params.hostedEnvStatus,
  ];
}

export function formatHostedStripeEnvStatus(
  target: Exclude<StripeBootstrapTarget, "local">,
  existingKeys: readonly VercelEnvKey[],
): string[] {
  const environment = target === "prod" ? "production" : "preview";
  const environmentLabel = target === "prod" ? "Production" : "Preview";
  const missing = STRIPE_ENV_KEYS.filter(
    (key) => !hasVercelEnvKey(existingKeys, key, environment),
  );

  if (missing.length === 0) {
    return [
      `Vercel ${environmentLabel} Stripe env already has ${STRIPE_ENV_KEYS.join(", ")}.`,
    ];
  }

  const lines = [
    `Vercel ${environmentLabel} Stripe env is missing ${missing.join(", ")}.`,
  ];
  const previewHasStripeEnv = STRIPE_ENV_KEYS.some((key) =>
    hasVercelEnvKey(existingKeys, key, "preview"),
  );
  if (target === "prod" && previewHasStripeEnv) {
    lines.push(
      "Vercel Preview Stripe env does not configure Production; run production setup to sync Production explicitly.",
    );
  }
  return lines;
}

export function formatStripeAccountVerificationFailure(
  error: unknown,
): StripeVerificationFailure {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const missingPermission = extractStripeMissingPermission(rawMessage);
  const accountId = extractStripeAccountId(rawMessage);
  const canContinueWithoutAccountRead =
    missingPermission?.scope === "accounts_kyc_basic_read" && !!accountId;
  const editUrl = extractStripeEditUrl(rawMessage);
  const message = canContinueWithoutAccountRead
    ? [
        "Stripe accepted the key, but the key cannot read account metadata.",
        "That permission is not always available in the restricted-key UI.",
        `Stripe returned account ID: ${accountId}`,
        "",
        "Bootstrap can continue after you confirm this is the intended Stripe account.",
      ]
    : [
        "Stripe could not verify this key before bootstrap makes billing changes.",
        "For restricted keys, Atlas must be able to confirm the account first.",
        "",
        missingPermission
          ? `Missing permission: ${missingPermission.label} (${missingPermission.scope})`
          : "Missing permission: account metadata read access",
        "",
        "Open the restricted key in Stripe and add Accounts v2 read access.",
        editUrl
          ? `Edit key: ${editUrl}`
          : "Then paste the updated key into bootstrap again.",
      ];
  if (editUrl && !canContinueWithoutAccountRead) {
    message.push("Then paste the updated key into bootstrap again.");
  }

  return {
    accountId: accountId ?? undefined,
    canContinueWithoutAccountRead,
    message: message.join("\n"),
    summary: "Stripe key cannot verify the Stripe account.",
    title: "Stripe key permissions",
  };
}

export function formatStripeMetadataUnavailablePrompt(
  accountId: string,
): string {
  return [
    `Continue with Stripe account ${accountId}?`,
    "",
    "Bootstrap could not read the account display name with this restricted key.",
    "It will continue by testing the permissions Atlas actually needs:",
    "products, prices, coupons, customers, checkout sessions, and webhook endpoints.",
  ].join("\n");
}

export function formatStripeVerificationRetryPrompt(): string {
  return [
    "Paste an updated Stripe API key now?",
    "",
    "After you add the missing permission in Stripe, bootstrap will retry",
    "account verification in this same Stripe phase.",
    "Leaving this pending continues the rest of bootstrap without changing Stripe.",
  ].join("\n");
}

interface StripeMissingPermission {
  label: string;
  scope: string;
}

function extractStripeMissingPermission(
  message: string,
): StripeMissingPermission | null {
  const match = /Enabling "([^"]+)" \('([^']+)'\)/.exec(message);
  if (!match?.[1] || !match[2]) {
    return null;
  }
  return {
    label: match[1],
    scope: match[2],
  };
}

function extractStripeAccountId(message: string): string | null {
  const match = /account '([^']+)'/.exec(message);
  return match?.[1] ?? null;
}

function extractStripeEditUrl(message: string): string | null {
  const match = /https:\/\/dashboard\.stripe\.com\/\S+/.exec(message);
  return match?.[0] ? redactStripeKeyIds(match[0]) : null;
}

function redactStripeKeyIds(value: string): string {
  return value.replace(
    /mk_[A-Za-z0-9]+|rk_(?:live|test)_[A-Za-z0-9]+/g,
    "[key]",
  );
}

export function stripeDoctorFollowUp(
  target: StripeBootstrapTarget,
  envMode: "test" | "live",
): string[] {
  if (target === "prod") {
    return [
      ...stripeLiveRestrictedKeySetupSteps(),
      `That command converges Stripe ${envMode} products, coupons, the production webhook, .env.production, and Vercel Production env vars.`,
      "Run `pnpm stripe:verify:prod` after setup.",
    ];
  }

  if (target === "staging") {
    return [
      `Run \`${setupCommandForTarget(target)}\` to converge Stripe ${envMode} products, coupons, the staging webhook, .env.staging, and Vercel Preview env vars.`,
      "Run `pnpm stripe:verify:staging` after setup.",
    ];
  }

  return [
    `Run \`${setupCommandForTarget(target)}\` to converge Stripe ${envMode} products, coupons, local env files, and the local webhook secret.`,
    "Run `pnpm stripe:listen` in a separate terminal while testing Checkout locally.",
    "Run `pnpm stripe:verify:local` after setup.",
    "For staging setup: `pnpm bootstrap --target staging`.",
    "For production setup: `pnpm bootstrap`.",
  ];
}
