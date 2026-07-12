import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { useAtlasSession } from "@/domains/access/client/use-atlas-session";
import { AccountSetupPage } from "@/domains/access";
import { createWorkspace } from "@/domains/access/organizations.functions";
import {
  attachPurchaseWorkspace,
  ensurePurchaseOnboarding,
  loadPurchaseOnboarding,
  startPurchaseCheckout,
} from "@/domains/billing/purchase-onboarding.functions";
import { PRODUCT_LABELS } from "@/domains/billing/product-labels";
import { Button } from "@/platform/ui/button";
import { Input } from "@/platform/ui/input";

const DEFAULT_PRODUCT = "atlas_team";

export const startPurchaseSearchSchema = z.object({
  interval: z.enum(["monthly", "yearly", "four_month", "once", "weekly"]).optional(),
  product: z.enum(["atlas_pro", "atlas_team", "atlas_research_pass"]).optional(),
  purchase: z.string().optional(),
  step: z.enum(["payment"]).optional(),
});

type StartPurchaseSearch = z.infer<typeof startPurchaseSearchSchema>;
type StartPurchaseProduct = NonNullable<StartPurchaseSearch["product"]>;
type StartPurchaseInterval = NonNullable<StartPurchaseSearch["interval"]>;

interface PurchaseOnboardingIntent {
  expiresAt: string;
  id: string;
  interval: StartPurchaseInterval;
  product: StartPurchaseProduct;
  status: string;
  stripeCheckoutSessionId: string | null;
  userId: string;
  workspaceId: string | null;
}

interface StartPurchasePageProps {
  interval?: StartPurchaseSearch["interval"];
  product?: StartPurchaseSearch["product"];
  purchase?: string;
  step?: StartPurchaseSearch["step"];
}

function buildStartRedirect(product: string, interval: string): string {
  const params = new URLSearchParams({ product, interval });
  return `/start?${params.toString()}`;
}

function defaultIntervalForProduct(product: StartPurchaseProduct) {
  return product === "atlas_research_pass" ? "once" : "monthly";
}

function isValidProductInterval(
  product: StartPurchaseProduct,
  interval: StartPurchaseInterval,
): boolean {
  if (product === "atlas_pro") {
    return interval === "monthly" || interval === "yearly" || interval === "four_month";
  }
  if (product === "atlas_team") {
    return interval === "monthly" || interval === "yearly";
  }
  return interval === "once" || interval === "weekly";
}

function initialWorkspaceName(): string {
  return "Team Workspace";
}

function purchaseStatusCanUseWorkspace(status: string): boolean {
  return status === "started" || status === "account_ready" || status === "workspace_ready";
}

function purchaseIntentIsUsable(intent: PurchaseOnboardingIntent): boolean {
  return purchaseStatusCanUseWorkspace(intent.status) && Date.parse(intent.expiresAt) > Date.now();
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .replace(/-{2,}/g, "-") || "team-workspace"
  );
}

export function StartPurchasePage({ interval, product, purchase }: StartPurchasePageProps) {
  const session = useAtlasSession();
  const [purchaseIntent, setPurchaseIntent] = useState<PurchaseOnboardingIntent | null>(null);
  const [purchaseLookupFailed, setPurchaseLookupFailed] = useState(false);
  const selectedProduct = purchaseIntent?.product ?? product ?? DEFAULT_PRODUCT;
  const selectedInterval =
    purchaseIntent?.interval ?? interval ?? defaultIntervalForProduct(selectedProduct);
  const validSelection = isValidProductInterval(selectedProduct, selectedInterval);
  const sessionData = session.data;
  const [workspaceName, setWorkspaceName] = useState(initialWorkspaceName());
  const [workspaceSlug, setWorkspaceSlug] = useState(slugify(initialWorkspaceName()));
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const purchaseId = purchaseIntent?.id ?? purchase ?? null;
  const productLabel = PRODUCT_LABELS[selectedProduct];
  const startRedirect = useMemo(
    () => buildStartRedirect(selectedProduct, selectedInterval),
    [selectedInterval, selectedProduct],
  );
  const isReady = Boolean(sessionData?.accountReady && sessionData.hasPasskey);
  const activeWorkspace = sessionData?.workspace.activeOrganization ?? null;
  const canUseActiveWorkspace =
    Boolean(activeWorkspace) &&
    (selectedProduct !== "atlas_team" || activeWorkspace?.workspaceType === "team");
  const workspaceAttached = Boolean(purchaseIntent?.workspaceId);
  const purchaseLookupPending = Boolean(purchase && !purchaseIntent && !purchaseLookupFailed);
  const purchaseUnavailable =
    Boolean(purchase) &&
    (purchaseLookupFailed || (purchaseIntent !== null && !purchaseIntentIsUsable(purchaseIntent)));

  useEffect(() => {
    if (!sessionData || !purchase) {
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const intent = await loadPurchaseOnboarding({ data: { purchaseId: purchase } });
        if (!cancelled) {
          setPurchaseIntent(intent);
          setPurchaseLookupFailed(intent === null);
        }
      } catch {
        if (!cancelled) {
          setPurchaseLookupFailed(true);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [purchase, sessionData]);

  useEffect(() => {
    if (!sessionData || purchase || purchaseIntent || !validSelection) {
      return;
    }
    let cancelled = false;
    const start = async () => {
      const intent = await ensurePurchaseOnboarding({
        data: { product: selectedProduct, interval: selectedInterval },
      });
      if (!cancelled) {
        setPurchaseIntent(intent);
      }
    };
    void start();
    return () => {
      cancelled = true;
    };
  }, [purchase, purchaseIntent, selectedInterval, selectedProduct, sessionData, validSelection]);

  const handleUseActiveWorkspace = async () => {
    if (!purchaseId || !activeWorkspace) {
      return;
    }
    setErrorMessage(null);
    setIsPending(true);
    try {
      await attachPurchaseWorkspace({
        data: { purchaseId, workspaceId: activeWorkspace.id },
      }).then(setPurchaseIntent);
    } catch {
      setErrorMessage("Atlas could not attach that workspace. Try again.");
    } finally {
      setIsPending(false);
    }
  };

  const handleCreateWorkspace = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!purchaseId) {
      return;
    }
    setErrorMessage(null);
    setIsPending(true);
    try {
      const created = await createWorkspace({
        data: {
          name: workspaceName,
          slug: workspaceSlug,
          workspaceType: selectedProduct === "atlas_team" ? "team" : "individual",
        },
      });
      await attachPurchaseWorkspace({
        data: { purchaseId, workspaceId: created.id },
      }).then(setPurchaseIntent);
    } catch {
      setErrorMessage("Atlas could not create that workspace. Try another name or slug.");
    } finally {
      setIsPending(false);
    }
  };

  const handleCheckout = async () => {
    if (!purchaseId) {
      return;
    }
    setErrorMessage(null);
    setIsPending(true);
    try {
      const result = await startPurchaseCheckout({ data: { purchaseId } });
      window.location.assign(result.url);
    } catch {
      setErrorMessage("Atlas could not open Stripe checkout. Try again.");
      setIsPending(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8">
      <div className="space-y-3">
        <p className="type-label-medium text-outline">Atlas</p>
        <h1 className="type-display-small text-on-surface">Start {productLabel}</h1>
        <p className="type-body-large text-outline">
          Create your account, set up the workspace, then continue to payment.
        </p>
      </div>

      <div className="border-outline-variant bg-surface-container-lowest grid gap-3 rounded-2xl border p-4 sm:grid-cols-4">
        {["Account", "Workspace", "Payment", "Setup"].map((label) => (
          <div key={label} className="type-label-medium text-on-surface">
            {label}
          </div>
        ))}
      </div>

      <div className="border-outline-variant rounded-2xl border p-4">
        <p className="type-label-medium text-outline">Selected plan</p>
        <p className="type-title-large text-on-surface">{productLabel}</p>
        <p className="type-body-medium text-outline">Billing: {selectedInterval}</p>
      </div>

      {!validSelection ? (
        <div className="space-y-4">
          <p className="type-title-large text-on-surface">Choose a billing option</p>
          <p className="type-body-medium text-outline">
            That billing interval is not available for {productLabel}.
          </p>
          <Link to="/pricing" className="no-underline">
            <Button>View pricing</Button>
          </Link>
        </div>
      ) : (
        <>
          {errorMessage ? (
            <p role="alert" className="type-body-medium bg-error-container rounded-2xl px-4 py-3">
              {errorMessage}
            </p>
          ) : null}

          {sessionData === undefined || purchaseLookupPending ? null : sessionData === null ? (
            <div className="space-y-4">
              <p className="type-title-large text-on-surface">Create your Atlas account</p>
              <p className="type-body-medium text-outline">
                Use an email link to create or open your account. Your selected plan stays here.
              </p>
              <div className="flex flex-wrap gap-3">
                <Link to="/sign-up" search={{ redirect: startRedirect }} className="no-underline">
                  <Button>Create account</Button>
                </Link>
                <Link to="/sign-in" search={{ redirect: startRedirect }} className="no-underline">
                  <Button variant="secondary">Sign in</Button>
                </Link>
              </div>
            </div>
          ) : purchaseUnavailable ? (
            <div className="space-y-4">
              <p className="type-title-large text-on-surface">Purchase unavailable</p>
              <p className="type-body-medium text-outline">
                This purchase link has expired or is no longer available.
              </p>
              <Link to="/pricing" className="no-underline">
                <Button>View pricing</Button>
              </Link>
            </div>
          ) : !isReady ? (
            <AccountSetupPage redirectTo={startRedirect} />
          ) : workspaceAttached ? (
            <div className="space-y-4">
              <p className="type-title-large text-on-surface">Continue to payment</p>
              <p className="type-body-medium text-outline">
                Stripe will handle the payment details for {productLabel}.
              </p>
              <Button onClick={() => void handleCheckout()} disabled={isPending || !purchaseId}>
                {isPending ? "Opening Stripe..." : "Continue to Stripe"}
              </Button>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="space-y-2">
                <p className="type-title-large text-on-surface">Workspace</p>
                <p className="type-body-medium text-outline">
                  {selectedProduct === "atlas_team"
                    ? "Create the team workspace this subscription will belong to."
                    : "Confirm the workspace this purchase will belong to."}
                </p>
              </div>

              {canUseActiveWorkspace && activeWorkspace ? (
                <Button onClick={() => void handleUseActiveWorkspace()} disabled={isPending}>
                  Use {activeWorkspace.name}
                </Button>
              ) : null}

              <form className="space-y-4" onSubmit={(event) => void handleCreateWorkspace(event)}>
                <Input
                  label="Workspace name"
                  value={workspaceName}
                  onChange={(value) => {
                    setWorkspaceName(value);
                    setWorkspaceSlug(slugify(value));
                  }}
                  required
                />
                <Input
                  label="Workspace slug"
                  value={workspaceSlug}
                  onChange={setWorkspaceSlug}
                  required
                />
                <Button type="submit" disabled={isPending || !purchaseId || !workspaceName.trim()}>
                  {isPending ? "Saving..." : "Continue to payment"}
                </Button>
              </form>
            </div>
          )}
        </>
      )}
    </div>
  );
}
