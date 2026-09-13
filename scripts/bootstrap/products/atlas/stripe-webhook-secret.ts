/** Finding the billing webhook's signing secret and the URL it should point at. */

import path from "node:path";
import type Stripe from "stripe";
import { note, text } from "@clack/prompts";
import pc from "picocolors";
import { mergeEnvFile, parseEnvFile } from "../../lib/env-file.js";
import { logSubline, promptOrExit } from "../../lib/ui.js";
import { runStripeCli } from "../stripe-cli-client.js";
import { ensureBillingWebhookEndpoint } from "./catalog.js";
import {
  resolveStripeEnvFileTargets,
  stripeWebhookUrlForOrigin,
  type StripeBootstrapTarget,
} from "./env.js";
import { formatStripeWebhookUrlPromptMessage } from "./stripe-copy.js";

interface ResolveWebhookSecretParams {
  apiKey: string;
  followUpItems: string[];
  projectRoot: string;
  stripe: Stripe;
  target: StripeBootstrapTarget;
}

export async function resolveWebhookSecret(
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
