import type Stripe from "stripe";

function portalSettings(publicOrigin: string) {
  const origin = new URL(publicOrigin);
  if (origin.protocol !== "https:" || origin.username || origin.password) {
    throw new Error("Atlas billing portal requires an HTTPS public origin.");
  }
  return {
    name: "Atlas billing",
    business_profile: {
      privacy_policy_url: new URL("/privacy", origin).toString(),
      terms_of_service_url: new URL("/terms", origin).toString(),
    },
    features: {
      customer_update: { enabled: false },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: { enabled: true, mode: "at_period_end" as const },
      subscription_update: { enabled: false },
    },
    metadata: {
      atlas_portal: "billing",
      atlas_origin: origin.origin,
    },
  };
}

/** Keep Atlas customer exits independent of another product's default portal. */
export async function ensureBillingPortalConfiguration(
  stripe: Stripe,
  publicOrigin: string,
  configuredId?: string,
): Promise<Stripe.BillingPortal.Configuration> {
  const settings = portalSettings(publicOrigin);
  if (configuredId?.trim()) {
    const existing = await stripe.billingPortal.configurations.retrieve(
      configuredId.trim(),
    );
    if (
      existing.metadata?.atlas_portal !== "billing" ||
      existing.metadata.atlas_origin !== settings.metadata.atlas_origin
    ) {
      throw new Error(
        "Configured portal does not belong to this Atlas origin.",
      );
    }
    return stripe.billingPortal.configurations.update(existing.id, {
      ...settings,
      active: true,
    });
  }

  const listed = await stripe.billingPortal.configurations.list({ limit: 100 });
  if (listed.has_more) {
    throw new Error(
      "Portal inventory is incomplete; provide the Atlas portal configuration ID.",
    );
  }
  const matches = listed.data.filter(
    (configuration) =>
      configuration.metadata?.atlas_portal === "billing" &&
      configuration.metadata.atlas_origin === settings.metadata.atlas_origin,
  );
  if (matches.length > 1) {
    throw new Error(
      "Multiple Atlas billing portal configurations exist; select one by ID.",
    );
  }
  const match = matches[0];
  if (match) {
    return stripe.billingPortal.configurations.update(match.id, {
      ...settings,
      active: true,
    });
  }
  return stripe.billingPortal.configurations.create(settings);
}
