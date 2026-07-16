export type SetupProduct = "atlas_pro" | "atlas_team" | "atlas_research_pass";
export type SetupInterval = "monthly" | "yearly" | "four_month" | "once" | "weekly";

export interface PurchaseOnboardingIntent {
  expiresAt: string;
  id: string;
  interval: SetupInterval;
  product: SetupProduct;
  status: string;
  stripeCheckoutSessionId: string | null;
  userId: string;
  workspaceId: string | null;
}

export const DEFAULT_ONBOARDING_PRODUCT: SetupProduct = "atlas_team";

export function buildOnboardingStartRedirect(product: SetupProduct, interval: SetupInterval): string {
  const params = new URLSearchParams({ product, interval });
  return `/onboarding?${params.toString()}`;
}

export function defaultOnboardingInterval(product: SetupProduct): SetupInterval {
  return product === "atlas_research_pass" ? "once" : "monthly";
}

export function isValidOnboardingSelection(
  product: SetupProduct,
  interval: SetupInterval,
): boolean {
  if (product === "atlas_pro") {
    return interval === "monthly" || interval === "yearly" || interval === "four_month";
  }
  if (product === "atlas_team") {
    return interval === "monthly" || interval === "yearly";
  }
  return interval === "once" || interval === "weekly";
}

export function canUsePurchaseWorkspace(intent: PurchaseOnboardingIntent): boolean {
  const usableStatus =
    intent.status === "started" ||
    intent.status === "account_ready" ||
    intent.status === "workspace_ready";
  return usableStatus && Date.parse(intent.expiresAt) > Date.now();
}

export function onboardingWorkspaceSlug(value: string): string {
  return (
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .replace(/-{2,}/g, "-") || "team-workspace"
  );
}
