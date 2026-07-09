import path from "node:path";
import Stripe from "stripe";
import { log, note, password, spinner, text } from "@clack/prompts";
import pc from "picocolors";
import { mergeEnvFile, parseEnvFile } from "../../lib/env-file.js";
import {
  detectAndLink,
  fetchExistingKeys,
  getVercelScope,
  syncEnvVars,
} from "../../lib/vercel.js";
import { logSubline, promptConfirm, promptOrExit } from "../../lib/ui.js";
import type { PhaseResult, ReadinessState } from "../../state.js";
import { markPhase } from "../../state.js";
import {
  resolveStripeApiKey,
  runStripeCli,
  stripeApiKeyResolutionNotes,
} from "../stripe-cli-client.js";
import {
  ensureBillingWebhookEndpoint,
  ensureCoupon,
  ensureDefaultProductPrice,
  ensurePrice,
  ensureProduct,
  retireNonCatalogPrices,
} from "./catalog.js";
import {
  buildStripeEnvUpdates,
  buildStripeVercelEnvVars,
  resolveStripeEnvFileTargets,
  resolveStripeMode,
  STRIPE_ENV_KEYS,
  type StripeRuntimeMode,
  stripeWebhookUrlForOrigin,
  validateStripeApiKeyMode,
  type StripeBootstrapTarget,
} from "./env.js";
import { ATLAS_COUPONS, ATLAS_PRODUCTS } from "../../config/products.js";
import { setupCommandForTarget as repoSetupCommandForTarget } from "../../config/setup-manifest.js";
import type { AtlasProductDefinition } from "../../config/products.js";

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
    "",
    "Choose Yes only if this is the Stripe account bootstrap should modify.",
    "Choose No to paste a different API key before any Stripe catalog changes are made.",
  ].join("\n");
}

/**
 * Phase 6: Stripe product sync orchestrator.
 *
 * Ensures all Atlas products, prices, coupons, and billing webhook endpoints
 * exist in the requested Stripe mode and writes the runtime IDs into the
 * correct target env files.
 */
export async function runProductPhase(
  projectRoot: string,
  state: ReadinessState,
  doctorMode: boolean,
  live: boolean,
  target: StripeBootstrapTarget,
  assumeYes = false,
): Promise<PhaseResult> {
  const followUpItems: string[] = [];
  let envMode: ReturnType<typeof resolveStripeMode>;

  try {
    envMode = resolveStripeMode(target, live);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(message);
    markPhase(state, "product", "failed", message);
    return { success: false, followUpItems: [message] };
  }

  const envFileTargets = resolveStripeEnvFileTargets(projectRoot, target);
  let apiKey = resolveStripeApiKey(projectRoot, live, envFileTargets);
  const missingKeyFollowUp =
    target === "prod"
      ? "Production Stripe setup needs a live restricted key before bootstrap can change Stripe."
      : "Set STRIPE_API_KEY in .env or run `stripe login`";
  const apiKeyResolutionNotes = stripeApiKeyResolutionNotes(
    projectRoot,
    live,
    envFileTargets,
  );
  const hostedEnvStatus =
    target === "local" ? [] : hostedStripeEnvStatus(projectRoot, target);

  if (!apiKey) {
    if (doctorMode) {
      log.warn("Stripe API key not found");
      for (const guidanceLine of formatStripeMissingApiKeyGuidance({
        apiKeyResolutionNotes,
        hostedEnvStatus,
        target,
      })) {
        logSubline(guidanceLine);
      }
      markPhase(state, "product", "failed", "Missing Stripe API key");
      return {
        success: false,
        followUpItems:
          target === "prod"
            ? [
                ...apiKeyResolutionNotes,
                ...hostedEnvStatus,
                ...stripeDoctorFollowUp(target, envMode),
              ]
            : [...hostedEnvStatus, missingKeyFollowUp],
      };
    }

    const prompted = await promptOrExit(
      password({
        message: formatStripeApiKeyPromptMessage(envMode),
      }),
    );

    if (typeof prompted !== "string" || !prompted.trim()) {
      log.warn("Stripe API key not provided -- skipping product sync");
      markPhase(state, "product", "skipped", "No API key provided");
      return {
        success: false,
        followUpItems: [`${missingKeyFollowUp}, then re-run bootstrap`],
      };
    }

    apiKey = prompted.trim();
  }

  try {
    validateStripeApiKeyMode(apiKey, envMode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(message);
    markPhase(state, "product", "failed", message);
    return { success: false, followUpItems: [message] };
  }

  let stripe: Stripe;
  try {
    const confirmed = await confirmStripeAccount({
      apiKey,
      assumeYes,
      doctorMode,
      mode: envMode,
      target,
    });
    if (!confirmed) {
      markPhase(state, "product", "failed", "Stripe account not confirmed");
      return {
        success: false,
        followUpItems: [
          "Confirm the intended Stripe account or provide a different Stripe API key.",
        ],
      };
    }
    apiKey = confirmed.apiKey;
    stripe = confirmed.stripe;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(message);
    markPhase(state, "product", "failed", message);
    return {
      success: false,
      followUpItems: ["Fix Stripe API key and re-run bootstrap"],
    };
  }

  if (doctorMode) {
    followUpItems.push(...stripeDoctorFollowUp(target, envMode));
    markPhase(state, "product", "partial", "Doctor mode did not mutate Stripe");
    return { success: false, followUpItems };
  }

  const stripeIds = new Map<string, string>();
  const productIds = new Map<AtlasProductDefinition["id"], string>();
  let allSucceeded = true;

  for (const definition of ATLAS_PRODUCTS) {
    try {
      const productId = await processProduct(stripe, definition, stripeIds);
      productIds.set(definition.id, productId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error(
        `Failed to process product "${definition.stripeName}": ${message}`,
      );
      followUpItems.push(
        `Manually sync Stripe product "${definition.stripeName}" (${definition.id})`,
      );
      allSucceeded = false;
    }
  }

  for (const definition of ATLAS_COUPONS) {
    try {
      const couponProductIds = definition.appliesToProductIds.map(
        (productId) => {
          const stripeProductId = productIds.get(productId);
          if (!stripeProductId) {
            throw new Error(
              `Missing Stripe product for coupon target "${productId}".`,
            );
          }
          return stripeProductId;
        },
      );
      const coupon = await ensureCoupon(stripe, definition, couponProductIds);
      stripeIds.set(definition.envKey, coupon.id);
      logSubline(`${definition.segment}: ${pc.dim(coupon.id)} coupon`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error(`Failed to process coupon "${definition.name}": ${message}`);
      followUpItems.push(`Manually sync Stripe coupon "${definition.name}"`);
      allSucceeded = false;
    }
  }

  const webhookSecret = await resolveWebhookSecret({
    apiKey,
    followUpItems,
    projectRoot,
    stripe,
    target,
  });
  if (!webhookSecret) {
    allSucceeded = false;
  }

  const envUpdates = buildStripeEnvUpdates(apiKey, webhookSecret, stripeIds);
  for (const envFile of envFileTargets) {
    mergeEnvFile(envFile, envUpdates);
    log.success(
      `Wrote ${envUpdates.size} Stripe values to ${pc.dim(path.relative(projectRoot, envFile))}`,
    );
  }

  if (target !== "local") {
    const synced = await syncHostedStripeEnv(
      projectRoot,
      target,
      envUpdates,
      followUpItems,
      assumeYes,
    );
    if (!synced) {
      allSucceeded = false;
    }
  }

  const status = allSucceeded ? "complete" : "partial";
  markPhase(
    state,
    "product",
    status,
    `${envUpdates.size} env vars written for ${target}`,
  );

  if (!allSucceeded) {
    followUpItems.push(
      `Re-run \`${setupCommandForTarget(target)}\` to retry failed Stripe syncs`,
    );
  }

  return { success: allSucceeded, followUpItems };
}

function setupCommandForTarget(target: StripeBootstrapTarget): string {
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
    "Create a restricted key named Atlas production bootstrap.",
    "Grant write access for Products, Prices, Coupons, Customers, Checkout Sessions, and Webhook Endpoints.",
    "Reveal the key once, copy the rk_live_ value, and keep it out of chat and committed files.",
    "Run `STRIPE_API_KEY=rk_live_... pnpm setup:prod --yes` from this repo.",
  ];
}

export function formatStripeApiKeyPromptMessage(
  envMode: StripeRuntimeMode,
): string {
  if (envMode === "live") {
    const promptSteps = [
      "Open https://dashboard.stripe.com/apikeys and switch to Live mode.",
      "Choose The Rebuilding America Project account.",
      "Open Restricted keys and create a key named Atlas production bootstrap.",
      "Grant write access for Products, Prices, Coupons, Customers, Checkout Sessions, and Webhook Endpoints.",
      "Reveal the key once, copy the rk_live_ value, and keep it out of chat and committed files.",
    ];
    return [
      "Stripe live mode API key",
      "",
      "Use a Dashboard-created live restricted key for production bootstrap:",
      ...promptSteps.map((step, index) => `${index + 1}. ${step}`),
      "",
      "Paste the rk_live_ value here. A full sk_live_ key is accepted, but rk_live_ is preferred.",
      "Bootstrap will create or update the Atlas Stripe catalog, webhook, env files, and Vercel Production env vars after this.",
    ].join("\n");
  }

  return [
    "Stripe test mode API key",
    "",
    "For local and staging, run `stripe login` first so bootstrap can use your Stripe CLI test key.",
    "If you need to paste a key manually, use a test key that starts with sk_test_ or rk_test_.",
    "",
    "Paste the test key here, or leave blank to skip Stripe product setup.",
  ].join("\n");
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
  existingKeys: ReadonlySet<string>,
): string[] {
  const environment = target === "prod" ? "production" : "preview";
  const environmentLabel = target === "prod" ? "Production" : "Preview";
  const missing = STRIPE_ENV_KEYS.filter(
    (key) => !existingKeys.has(`${key}:${environment}`),
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
    existingKeys.has(`${key}:preview`),
  );
  if (target === "prod" && previewHasStripeEnv) {
    lines.push(
      "Vercel Preview Stripe env does not configure Production; run production setup to sync Production explicitly.",
    );
  }
  return lines;
}

function hostedStripeEnvStatus(
  projectRoot: string,
  target: Exclude<StripeBootstrapTarget, "local">,
): string[] {
  const appDir = path.join(projectRoot, "app");
  const scope = getVercelScope(appDir);
  if (!scope) {
    return [
      "Vercel project is not linked, so bootstrap cannot check hosted Stripe env metadata.",
    ];
  }
  return formatHostedStripeEnvStatus(
    target,
    fetchExistingKeys(scope, { cwd: appDir }),
  );
}

interface ConfirmStripeAccountParams {
  apiKey: string;
  assumeYes: boolean;
  doctorMode: boolean;
  mode: StripeRuntimeMode;
  target: StripeBootstrapTarget;
}

interface ConfirmedStripeAccount {
  apiKey: string;
  stripe: Stripe;
}

async function confirmStripeAccount(
  params: ConfirmStripeAccountParams,
): Promise<ConfirmedStripeAccount | null> {
  let apiKey = params.apiKey;

  while (true) {
    const stripe = new Stripe(apiKey, {
      apiVersion: "2026-06-24.dahlia",
    });
    const s = spinner();
    s.start("Checking which Stripe account this key can change...");

    let account: Stripe.Account;
    try {
      account = await stripe.accounts.retrieveCurrent();
    } catch (error) {
      s.stop("Failed to verify Stripe account");
      throw error;
    }

    const accountName = stripeAccountDisplayName(account);
    s.stop(`Stripe account found: ${pc.cyan(accountName)} (${params.mode})`);

    if (
      params.doctorMode ||
      params.assumeYes ||
      (await promptConfirm(
        formatStripeAccountPrompt({
          accountId: account.id,
          accountName,
          mode: params.mode,
          target: params.target,
        }),
        true,
      ))
    ) {
      return { apiKey, stripe };
    }

    const useDifferentKey = await promptConfirm(
      [
        "Enter a different Stripe API key now?",
        "",
        "Choose Yes to paste a key for the intended Stripe account.",
        "Choose No to stop Stripe setup without changing products, prices, coupons, or webhooks.",
      ].join("\n"),
      true,
    );
    if (!useDifferentKey) {
      return null;
    }

    const prompted = await promptOrExit(
      password({
        message: formatStripeApiKeyPromptMessage(params.mode),
      }),
    );
    if (typeof prompted !== "string" || !prompted.trim()) {
      return null;
    }
    const candidate = prompted.trim();
    try {
      validateStripeApiKeyMode(candidate, params.mode);
    } catch (error) {
      log.error(error instanceof Error ? error.message : String(error));
      continue;
    }
    apiKey = candidate;
  }
}

function stripeDoctorFollowUp(
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

interface ResolveWebhookSecretParams {
  apiKey: string;
  followUpItems: string[];
  projectRoot: string;
  stripe: Stripe;
  target: StripeBootstrapTarget;
}

async function resolveWebhookSecret(
  params: ResolveWebhookSecretParams,
): Promise<string | null> {
  const { apiKey, followUpItems, projectRoot, stripe, target } = params;
  const existingSecret = readExistingWebhookSecret(projectRoot, target);
  if (target === "local") {
    const localUrl = resolveLocalWebhookUrl(projectRoot);
    const result = runStripeCli(
      [
        "listen",
        "--print-secret",
        "--forward-to",
        localUrl,
        "--skip-verify",
        "--api-key",
        apiKey,
      ],
      false,
    );
    const secret = /whsec_[A-Za-z0-9]+/.exec(result.stdout)?.[0] ?? null;
    if (result.ok && secret) {
      logSubline(`Local Stripe webhook: ${pc.dim(localUrl)}`);
      return secret;
    }
    followUpItems.push(
      `Run \`pnpm stripe:listen\` and copy the printed whsec_ value into STRIPE_WEBHOOK_SECRET.`,
    );
    return existingSecret;
  }

  const webhookUrl = await resolveHostedWebhookUrl(projectRoot, target);
  const result = await ensureBillingWebhookEndpoint(stripe, webhookUrl);
  logSubline(`Stripe webhook endpoint: ${pc.dim(result.endpoint.url)}`);
  if (result.secret) {
    return result.secret;
  }
  if (existingSecret) {
    return existingSecret;
  }
  followUpItems.push(
    `Stripe webhook ${result.endpoint.id} already existed. Copy its signing secret into ${target === "prod" ? ".env.production" : ".env.staging"} as STRIPE_WEBHOOK_SECRET, or rotate the endpoint secret in Stripe and re-run bootstrap.`,
  );
  return null;
}

function readExistingWebhookSecret(
  projectRoot: string,
  target: StripeBootstrapTarget,
): string | null {
  for (const envFile of resolveStripeEnvFileTargets(projectRoot, target)) {
    const value = parseEnvFile(envFile).get("STRIPE_WEBHOOK_SECRET")?.trim();
    if (value) {
      return value;
    }
  }
  return null;
}

function resolveLocalWebhookUrl(projectRoot: string): string {
  const rootEnv = parseEnvFile(path.join(projectRoot, ".env"));
  const origin =
    rootEnv.get("ATLAS_PUBLIC_URL")?.trim() || "https://atlas.localhost";
  return stripeWebhookUrlForOrigin(origin);
}

async function resolveHostedWebhookUrl(
  projectRoot: string,
  target: Exclude<StripeBootstrapTarget, "local">,
): Promise<string> {
  const envFile = resolveStripeEnvFileTargets(projectRoot, target)[0];
  const env = parseEnvFile(envFile);
  const current = env.get("ATLAS_PUBLIC_URL")?.trim();
  if (current) {
    return stripeWebhookUrlForOrigin(current);
  }

  note(
    "Stripe needs the deployed Atlas app URL because webhooks are delivered to the app route at /api/stripe/webhook.",
    target === "prod" ? "Production Stripe webhook" : "Staging Stripe webhook",
  );
  const value = await promptOrExit(
    text({
      message: formatStripeWebhookUrlPromptMessage(target),
      placeholder:
        target === "prod"
          ? "https://atlas.rebuildingus.org"
          : "https://atlas-staging.rebuildingus.org",
      validate: (input) => {
        const candidate = input ?? "";
        if (!candidate.trim()) {
          return "Atlas URL is required.";
        }
        try {
          stripeWebhookUrlForOrigin(candidate);
        } catch (error) {
          return error instanceof Error
            ? error.message
            : "Enter a valid HTTPS URL.";
        }
      },
    }),
  );
  const origin = String(value);
  mergeEnvFile(
    envFile,
    new Map([
      ["ATLAS_PUBLIC_URL", new URL(stripeWebhookUrlForOrigin(origin)).origin],
    ]),
  );
  return stripeWebhookUrlForOrigin(origin);
}

async function syncHostedStripeEnv(
  projectRoot: string,
  target: Exclude<StripeBootstrapTarget, "local">,
  envUpdates: Map<string, string>,
  followUpItems: string[],
  assumeYes: boolean,
): Promise<boolean> {
  const varsToSync = buildStripeVercelEnvVars(envUpdates, target);
  if (varsToSync.length === 0) {
    return true;
  }

  const appDir = path.join(projectRoot, "app");
  await detectAndLink(appDir, { assumeYes });
  const scope = getVercelScope(appDir);
  if (!scope) {
    followUpItems.push(
      "Vercel project not linked — run `vercel link` in app/ then re-run Stripe bootstrap",
    );
    return false;
  }

  const synced = await syncEnvVars(varsToSync, scope, {
    assumeYes,
    cwd: appDir,
    targetLabel: target === "prod" ? "production" : "preview",
  });
  if (!synced) {
    followUpItems.push(
      `Stripe ${target} env values were not fully synced to Vercel — re-run \`${setupCommandForTarget(target)}\` after checking Vercel CLI output`,
    );
  }
  return synced;
}

async function processProduct(
  stripe: Stripe,
  definition: AtlasProductDefinition,
  envValues: Map<string, string>,
): Promise<string> {
  const product = await ensureProduct(stripe, definition);
  log.success(
    `${pc.bold(definition.stripeName)} -- ready (${pc.dim(product.id)})`,
  );
  envValues.set(definition.envProductKey, product.id);

  const canonicalPriceIds: string[] = [];
  for (const priceDef of definition.prices) {
    const price = await ensurePrice(stripe, product.id, priceDef);
    envValues.set(priceDef.envKey, price.id);
    canonicalPriceIds.push(price.id);
    logSubline(`${priceDef.id}: ${pc.dim(price.id)}`);
  }
  const [defaultPriceId] = canonicalPriceIds;
  if (defaultPriceId) {
    await ensureDefaultProductPrice(stripe, product, defaultPriceId);
  }
  const retiredPrices = await retireNonCatalogPrices(
    stripe,
    product.id,
    canonicalPriceIds,
  );
  if (retiredPrices.length > 0) {
    logSubline(`retired ${retiredPrices.length} non-catalog price(s)`);
  }
  return product.id;
}
