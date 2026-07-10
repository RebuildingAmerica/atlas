#!/usr/bin/env tsx
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { STRIPE_BILLING_WEBHOOK_EVENTS } from "../../config/products.js";
import { parseEnvFile } from "../../lib/env-file.js";
import { runInteractiveCommand } from "../../lib/shell.js";
import { stripeWebhookUrlForOrigin } from "./env.js";

export function resolveLocalStripeWebhookUrl(env: Map<string, string>): string {
  const origin =
    env.get("ATLAS_PUBLIC_URL")?.trim() || "https://atlas.localhost";
  return stripeWebhookUrlForOrigin(origin);
}

export function buildStripeListenArgs(webhookUrl: string): string[] {
  return [
    "listen",
    "--skip-verify",
    "--events",
    STRIPE_BILLING_WEBHOOK_EVENTS.join(","),
    "--forward-to",
    webhookUrl,
  ];
}

export function formatStripeListenCommand(args: readonly string[]): string {
  return `stripe ${args.join(" ")}`;
}

function projectRootFromScript(): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../..",
  );
}

function main(): void {
  const projectRoot = projectRootFromScript();
  const webhookUrl = resolveLocalStripeWebhookUrl(
    parseEnvFile(path.join(projectRoot, ".env")),
  );
  const args = buildStripeListenArgs(webhookUrl);
  console.log(`Forwarding Stripe billing webhooks to ${webhookUrl}`);
  const ok = runInteractiveCommand(formatStripeListenCommand(args));
  if (!ok) {
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
