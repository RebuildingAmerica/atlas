import "@tanstack/react-start/server-only";

import { getStripeClient } from "./stripe-client";
import {
  mergeAtlasOrganizationMetadata,
  normalizeAtlasOrganizationMetadata,
} from "../../access/organization-metadata";
import { ensureAuthReady } from "../../access/server/auth";

/**
 * Ensures a Stripe customer exists for the given Atlas workspace.
 *
 * If the workspace already has a stripeCustomerId in its metadata, this is a
 * no-op that returns the existing ID.  Otherwise a new Stripe customer is
 * created and the ID is persisted in the organization metadata.
 *
 * @param workspaceId - The Better Auth organization ID.
 * @param email - The primary contact email for the Stripe customer.
 * @param name - A display name for the Stripe customer (workspace name).
 */
export async function ensureStripeCustomerForWorkspace(
  workspaceId: string,
  email: string,
  name: string,
): Promise<string> {
  const auth = await ensureAuthReady();
  const headers = new Headers();

  const fullOrganization = await auth.api.getFullOrganization({
    headers,
    query: { organizationId: workspaceId },
  });

  if (!fullOrganization) {
    throw new Error(`Workspace ${workspaceId} not found.`);
  }

  const metadata = normalizeAtlasOrganizationMetadata(fullOrganization.metadata);

  if (metadata.stripeCustomerId) {
    return metadata.stripeCustomerId;
  }

  const stripe = getStripeClient();
  const customer = await stripe.customers.create({
    email,
    name,
    metadata: {
      atlas_workspace_id: workspaceId,
    },
  });

  const mergedMetadata = mergeAtlasOrganizationMetadata(fullOrganization.metadata, {
    stripeCustomerId: customer.id,
  });

  await auth.api.updateOrganization({
    body: {
      data: { metadata: mergedMetadata },
      organizationId: workspaceId,
    },
    headers,
  });

  return customer.id;
}
