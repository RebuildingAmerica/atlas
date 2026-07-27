import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  canManageAtlasOrganizationRole,
  normalizeAtlasOrganizationMetadata,
} from "@rebuildingamerica/atlas-access/workspace/organization-metadata";
import type { AtlasSelfServeProduct } from "@rebuildingamerica/atlas-access/workspace/capabilities";
import type { AtlasSessionPayload } from "@rebuildingamerica/atlas-access/workspace/organization-contracts";
import type { PricingCheckoutInterval } from "@/domains/billing/checkout-intervals";
import { getAtlasBillingProducts } from "@/domains/billing/products";
import type { AtlasBillingProducts } from "@/domains/billing/products";
import type { PurchaseIntentRecord } from "@/domains/billing/server/purchase-intents";

const purchaseProductSchema = z.enum(["atlas_pro", "atlas_team", "atlas_research_pass"]);
const purchaseIntervalSchema = z.enum(["monthly", "yearly", "four_month", "once", "weekly"]);

const ensurePurchaseInputSchema = z
  .object({
    interval: purchaseIntervalSchema,
    product: purchaseProductSchema,
  })
  .refine(({ interval, product }) => isValidProductInterval(product, interval), {
    message: "Selected billing interval is not available for this product.",
    path: ["interval"],
  });

const purchaseIdInputSchema = z.object({
  purchaseId: z.string().min(1),
});

const attachWorkspaceInputSchema = purchaseIdInputSchema.extend({
  workspaceId: z.string().min(1),
});

function getSessionWorkspace(session: AtlasSessionPayload, workspaceId: string) {
  return session.workspace.memberships.find((membership) => membership.id === workspaceId) ?? null;
}

function requireManagedBillingWorkspace(session: AtlasSessionPayload, workspaceId: string) {
  const workspace = getSessionWorkspace(session, workspaceId);
  if (!workspace) {
    throw new Error("Atlas could not find that workspace.");
  }
  if (!canManageAtlasOrganizationRole(workspace.role)) {
    throw new Error("You do not have permission to manage billing for this workspace.");
  }
  return workspace;
}

function resolvePriceId(
  products: AtlasBillingProducts,
  product: AtlasSelfServeProduct,
  interval: PricingCheckoutInterval,
): string {
  if (product === "atlas_pro") {
    if (interval === "four_month") {
      return products.atlas_pro.studentFourMonthPriceId;
    }
    return interval === "yearly"
      ? products.atlas_pro.yearlyPriceId
      : products.atlas_pro.monthlyPriceId;
  }
  if (product === "atlas_team") {
    return interval === "yearly"
      ? products.atlas_team.yearlyPriceId
      : products.atlas_team.monthlyPriceId;
  }
  return interval === "weekly"
    ? products.atlas_research_pass.weeklyPriceId
    : products.atlas_research_pass.oncePriceId;
}

function isValidProductInterval(
  product: AtlasSelfServeProduct,
  interval: PricingCheckoutInterval,
): boolean {
  if (product === "atlas_pro") {
    return interval === "monthly" || interval === "yearly" || interval === "four_month";
  }
  if (product === "atlas_team") {
    return interval === "monthly" || interval === "yearly";
  }
  return interval === "once" || interval === "weekly";
}

function resolveSeatPriceId(products: AtlasBillingProducts, interval: PricingCheckoutInterval) {
  return interval === "yearly"
    ? products.atlas_team.yearlySeatPriceId
    : products.atlas_team.monthlySeatPriceId;
}

function canStartCheckout(intent: PurchaseIntentRecord): boolean {
  if (intent.status !== "workspace_ready") return false;
  return Date.parse(intent.expiresAt) > Date.now();
}

function isTerminalPurchaseStatus(status: string): boolean {
  return status === "paid" || status === "cancelled" || status === "expired" || status === "failed";
}

function canAttachWorkspace(status: string): boolean {
  return status === "started" || status === "account_ready" || status === "workspace_ready";
}

async function loadPurchaseServerModules() {
  if (import.meta.env.SSR) {
    const [
      auth,
      checkout,
      purchaseIntents,
      requestHeaders,
      runtime,
      sessionState,
      stripeCustomer,
      webhookHandler,
    ] = await Promise.all([
      import("@/domains/access/server/auth"),
      import("@/domains/billing/server/checkout"),
      import("@/domains/billing/server/purchase-intents"),
      import("@/domains/access/server/request-headers"),
      import("@/domains/access/server/runtime"),
      import("@/domains/access/server/session-state"),
      import("@/domains/billing/server/stripe-customer"),
      import("@/domains/billing/server/webhook-handler"),
    ]);
    return {
      auth,
      checkout,
      purchaseIntents,
      requestHeaders,
      runtime,
      sessionState,
      stripeCustomer,
      webhookHandler,
    };
  }

  throw new Error("Purchase onboarding is only available on the server.");
}

export const ensurePurchaseOnboarding = createServerFn({ method: "POST" })
  .validator(ensurePurchaseInputSchema)
  .handler(async ({ data }) => {
    const { purchaseIntents, sessionState } = await loadPurchaseServerModules();
    const session = await sessionState.requireAtlasSessionState();
    return purchaseIntents.ensurePurchaseIntent({
      interval: data.interval,
      product: data.product,
      userId: session.user.id,
    });
  });

export const loadPurchaseOnboarding = createServerFn({ method: "POST" })
  .validator(purchaseIdInputSchema)
  .handler(async ({ data }) => {
    const { purchaseIntents, sessionState, webhookHandler } = await loadPurchaseServerModules();
    const session = await sessionState.requireAtlasSessionState();
    const intent = await purchaseIntents.loadPurchaseIntent({
      id: data.purchaseId,
      userId: session.user.id,
    });
    if (intent?.status !== "checkout_created" || !intent.stripeCheckoutSessionId) {
      return intent;
    }

    const reconciled = await webhookHandler.reconcilePaidCheckoutSession(
      intent.stripeCheckoutSessionId,
    );
    if (!reconciled) {
      return intent;
    }

    return purchaseIntents.loadPurchaseIntent({
      id: data.purchaseId,
      userId: session.user.id,
    });
  });

export const attachPurchaseWorkspace = createServerFn({ method: "POST" })
  .validator(attachWorkspaceInputSchema)
  .handler(async ({ data }) => {
    const { purchaseIntents, sessionState } = await loadPurchaseServerModules();
    const session = await sessionState.requireReadyAtlasSessionState();
    requireManagedBillingWorkspace(session, data.workspaceId);
    const intent = await purchaseIntents.loadPurchaseIntent({
      id: data.purchaseId,
      userId: session.user.id,
    });
    if (!intent || isTerminalPurchaseStatus(intent.status) || !canAttachWorkspace(intent.status)) {
      throw new Error("Atlas could not continue that purchase.");
    }
    return purchaseIntents.attachWorkspaceToPurchaseIntent({
      id: data.purchaseId,
      userId: session.user.id,
      workspaceId: data.workspaceId,
    });
  });

export const startPurchaseCheckout = createServerFn({ method: "POST" })
  .validator(purchaseIdInputSchema)
  .handler(async ({ data }) => {
    const {
      auth: authModule,
      checkout,
      purchaseIntents,
      requestHeaders,
      runtime: runtimeModule,
      sessionState,
      stripeCustomer,
    } = await loadPurchaseServerModules();
    const session = await sessionState.requireReadyAtlasSessionState();
    const intent = await purchaseIntents.loadPurchaseIntent({
      id: data.purchaseId,
      userId: session.user.id,
    });

    if (!intent) {
      throw new Error("Atlas could not find that purchase.");
    }
    if (!canStartCheckout(intent)) {
      throw new Error("Atlas could not continue that purchase.");
    }
    if (!intent.workspaceId) {
      throw new Error("Create a workspace before continuing to payment.");
    }
    requireManagedBillingWorkspace(session, intent.workspaceId);

    const auth = await authModule.ensureAuthReady();
    const headers = requestHeaders.getBrowserSessionHeaders();
    const runtime = runtimeModule.getAuthRuntimeConfig();
    const fullOrganization = await auth.api.getFullOrganization({
      headers,
      query: { organizationId: intent.workspaceId },
    });
    if (!fullOrganization) {
      throw new Error("Atlas could not find that workspace.");
    }
    const metadata = normalizeAtlasOrganizationMetadata(fullOrganization?.metadata);
    const products = getAtlasBillingProducts();
    const priceId = resolvePriceId(products, intent.product, intent.interval);

    let stripeCustomerId = metadata.stripeCustomerId;
    if (!stripeCustomerId) {
      try {
        stripeCustomerId = await stripeCustomer.ensureStripeCustomerForWorkspace(
          intent.workspaceId,
          session.user.email,
          fullOrganization?.name ?? "Atlas Workspace",
        );
      } catch {
        stripeCustomerId = null;
      }
    }

    let seatPriceId: string | null = null;
    let seatQuantity = 0;
    if (intent.product === "atlas_team") {
      const members = fullOrganization?.members;
      seatQuantity = Array.isArray(members) ? Math.max(0, members.length - 1) : 0;
      if (seatQuantity >= 1) {
        seatPriceId = resolveSeatPriceId(products, intent.interval);
      }
    }

    const successUrl = new URL("/onboarding/complete", runtime.publicBaseUrl);
    successUrl.searchParams.set("purchase", intent.id);
    const cancelUrl = new URL("/onboarding", runtime.publicBaseUrl);
    cancelUrl.searchParams.set("purchase", intent.id);
    cancelUrl.searchParams.set("product", intent.product);
    cancelUrl.searchParams.set("interval", intent.interval);
    cancelUrl.searchParams.set("step", "payment");

    const checkoutSession = await checkout.createCheckoutSession({
      workspaceId: intent.workspaceId,
      product: intent.product,
      interval: intent.interval,
      priceId,
      purchaseIntentId: intent.id,
      successUrl: successUrl.toString(),
      cancelUrl: cancelUrl.toString(),
      customerEmail: session.user.email,
      stripeCustomerId,
      seatPriceId,
      seatQuantity,
    });

    if (!checkoutSession.url) {
      throw new Error("Stripe did not return a checkout URL.");
    }

    await purchaseIntents.markPurchaseCheckoutCreated({
      id: intent.id,
      stripeCheckoutSessionId: checkoutSession.id,
      userId: session.user.id,
    });

    return { url: checkoutSession.url };
  });
