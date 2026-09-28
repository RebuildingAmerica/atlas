import "@tanstack/react-start/server-only";

import type Stripe from "stripe";
import { assertHostedE2EAuthorized } from "@/domains/access/server/hosted-e2e";
import { getAllowedBillingOffers } from "./billing-offers";
import { getStripeClient } from "./stripe-client";
import { inspectRuntimeBilling } from "./runtime-inventory";

/** A protected, read-only check inside the deployment that actually holds the Stripe key. */
export async function handleRuntimeBillingInventoryRequest(
  request: Request,
  env: NodeJS.ProcessEnv = process.env,
  getClient: () => Stripe = getStripeClient,
): Promise<Response> {
  const denied = assertHostedE2EAuthorized(request, env);
  if (denied) return denied;

  try {
    const checks = await inspectRuntimeBilling(getClient(), env);
    const candidateRevision = (env.ATLAS_RELEASE_SHA || env.VERCEL_GIT_COMMIT_SHA)?.trim() ?? "";
    const revision = /^[a-f0-9]{40}$/i.test(candidateRevision)
      ? candidateRevision.toLowerCase()
      : "unknown";
    // The pricing page already shows these offers, so reporting them leaks
    // nothing; the hosted checkout proof uses them to pick an offer to open.
    return Response.json(
      { revision, checks, allowedOffers: getAllowedBillingOffers(env) },
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch {
    return Response.json(
      { error: "Billing inventory unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
