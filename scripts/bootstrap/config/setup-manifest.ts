import type { StripeBootstrapTarget } from "../products/atlas/env.js";

export type SetupValueTarget = StripeBootstrapTarget;
export type SetupValueSource = "human" | "bootstrap" | "provider";

export interface SetupValueManifestItem {
  key: string;
  label: string;
  targets: SetupValueTarget[];
  required: boolean;
  source: SetupValueSource;
  destinations: string[];
  instructions: string;
}

export const SETUP_VALUE_MANIFEST: SetupValueManifestItem[] = [
  {
    key: "ANTHROPIC_API_KEY",
    label: "Anthropic API key",
    targets: ["local", "staging", "prod"],
    required: true,
    source: "human",
    destinations: [".env", "api/.env"],
    instructions:
      "Create a Claude API key at https://console.anthropic.com/settings/keys.",
  },
  {
    key: "SEARCH_API_KEY",
    label: "Brave Search API key",
    targets: ["local", "staging", "prod"],
    required: false,
    source: "human",
    destinations: [".env", ".env.staging", ".env.production", "api/.env"],
    instructions:
      "Create one at https://brave.com/search/api/ if you want richer discovery sources.",
  },
  {
    key: "OPENSTATUS_API_KEY",
    label: "OpenStatus API key",
    targets: ["staging", "prod"],
    required: false,
    source: "human",
    destinations: [".env", ".env.staging", ".env.production"],
    instructions:
      "Create one at https://www.openstatus.dev/app/settings for hosted synthetic monitors.",
  },
  {
    key: "ATLAS_PUBLIC_URL",
    label: "Atlas app origin",
    targets: ["staging", "prod"],
    required: true,
    source: "human",
    destinations: [".env.staging", ".env.production", "Vercel"],
    instructions: "Use the public HTTPS app origin for the target environment.",
  },
  {
    key: "ATLAS_SERVER_API_PROXY_TARGET",
    label: "Atlas API origin",
    targets: ["staging", "prod"],
    required: true,
    source: "human",
    destinations: [".env.staging", ".env.production", "Vercel"],
    instructions:
      "Use the public HTTPS API origin that Vercel should proxy /api traffic to.",
  },
  {
    key: "ATLAS_DOCS_URL",
    label: "Mintlify docs origin",
    targets: ["staging", "prod"],
    required: true,
    source: "human",
    destinations: [".env.staging", ".env.production", "Vercel"],
    instructions:
      "Use the Mintlify deployment origin, then enable Host at /docs in Mintlify.",
  },
  {
    key: "DATABASE_URL",
    label: "PostgreSQL connection string",
    targets: ["staging", "prod"],
    required: true,
    source: "human",
    destinations: [".env.staging", ".env.production", "api/.env", "Vercel"],
    instructions:
      "Create or choose a Neon Postgres database and copy the pooled connection string.",
  },
  {
    key: "ATLAS_AUTH_INTERNAL_SECRET",
    label: "Internal auth secret",
    targets: ["local", "staging", "prod"],
    required: true,
    source: "bootstrap",
    destinations: [
      ".env",
      ".env.staging",
      ".env.production",
      "api/.env",
      "Vercel",
    ],
    instructions:
      "Bootstrap generates this shared app/API secret when it is missing.",
  },
  {
    key: "ATLAS_EDGE_ORIGIN_SECRET",
    label: "API edge origin secret",
    targets: ["staging", "prod"],
    required: true,
    source: "bootstrap",
    destinations: [".env.staging", ".env.production", "api/.env"],
    instructions:
      "Bootstrap generates this Cloudflare-to-API origin secret when it is missing.",
  },
  {
    key: "ATLAS_EMAIL_RESEND_API_KEY",
    label: "Resend API key",
    targets: ["staging", "prod"],
    required: true,
    source: "human",
    destinations: [".env.staging", ".env.production", "Vercel"],
    instructions:
      "Create a Resend API key after verifying the sender domain used by ATLAS_EMAIL_FROM.",
  },
  {
    key: "STRIPE_API_KEY",
    label: "Stripe API key",
    targets: ["local", "staging", "prod"],
    required: true,
    source: "human",
    destinations: [
      ".env",
      ".env.staging",
      ".env.production",
      "app/.env.local",
      "Vercel",
    ],
    instructions: [
      "Use Stripe CLI test auth for local/staging.",
      "For production, create a live restricted key named Atlas Production Billing.",
      "Set permissions: Read: Connect > Accounts. Write: Products, Prices, Coupons, Customers, Checkout Sessions, Webhook Endpoints.",
      "Then run setup with STRIPE_API_KEY=rk_live_...",
    ].join(" "),
  },
  {
    key: "STRIPE_WEBHOOK_SECRET",
    label: "Stripe webhook signing secret",
    targets: ["local", "staging", "prod"],
    required: true,
    source: "provider",
    destinations: [
      ".env",
      ".env.staging",
      ".env.production",
      "app/.env.local",
      "Vercel",
    ],
    instructions:
      "Bootstrap creates or verifies the target webhook; copy the signing secret if Stripe only returns an existing endpoint.",
  },
  {
    key: "STRIPE_ATLAS_CATALOG",
    label: "Stripe catalog JSON",
    targets: ["local", "staging", "prod"],
    required: true,
    source: "bootstrap",
    destinations: [
      ".env",
      ".env.staging",
      ".env.production",
      "app/.env.local",
      "Vercel",
    ],
    instructions:
      "Bootstrap generates this from the canonical Atlas products, prices, and coupons.",
  },
];

export function setupCommandForTarget(target: SetupValueTarget): string {
  if (target === "prod") {
    return "pnpm setup:prod";
  }
  if (target === "staging") {
    return "pnpm setup:staging";
  }
  return "pnpm setup:local";
}

export function manualSetupValues(
  target: SetupValueTarget,
): SetupValueManifestItem[] {
  return SETUP_VALUE_MANIFEST.filter(
    (item) => item.targets.includes(target) && item.source === "human",
  );
}

export function renderSetupGuide(target: SetupValueTarget): string {
  return [
    `Target: ${setupTargetLabel(target)}`,
    "Bootstrap will walk this one step at a time:",
    "1. Check required tools",
    "2. Confirm CLI accounts",
    "3. Collect environment values",
    "4. Configure infrastructure, database, billing, and deploy readiness",
    "Nothing is skipped by default. Use --local-only only for local setup.",
  ].join("\n");
}

function setupTargetLabel(target: SetupValueTarget): string {
  if (target === "prod") {
    return "Production";
  }
  if (target === "staging") {
    return "Staging";
  }
  return "Local";
}
