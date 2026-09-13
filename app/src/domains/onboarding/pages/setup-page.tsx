import { Link } from "@tanstack/react-router";
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { useAtlasSession } from "@/domains/access/client/use-atlas-session";
import { AccountSetupPage } from "@/domains/access";
import { createWorkspace } from "@/domains/access/organizations.functions";
import {
  attachPurchaseWorkspace,
  ensurePurchaseOnboarding,
  isCheckoutRefusalMessage,
  loadPurchaseOnboarding,
  startPurchaseCheckout,
} from "@/domains/billing/purchase-onboarding.functions";
import { PRODUCT_LABELS } from "@/domains/billing/product-labels";
import { PurchaseStepPanel, PurchaseStepRail, type PurchaseStepId } from "./setup-page-steps";
import { Button } from "@rebuildingamerica/atlas-ui/ui/button";
import { Input } from "@rebuildingamerica/atlas-ui/ui/input";
import {
  DEFAULT_ONBOARDING_PRODUCT,
  buildOnboardingStartRedirect,
  canUsePurchaseWorkspace,
  defaultOnboardingInterval,
  isValidOnboardingSelection,
  onboardingWorkspaceSlug,
  type PurchaseOnboardingIntent,
} from "@rebuildingamerica/atlas-access/onboarding/setup-state";

export const setupSearchSchema = z.object({
  interval: z.enum(["monthly", "yearly", "four_month", "once", "weekly"]).optional(),
  product: z.enum(["atlas_pro", "atlas_team", "atlas_research_pass"]).optional(),
  purchase: z.string().optional(),
  step: z.enum(["payment"]).optional(),
});

type SetupSearch = z.infer<typeof setupSearchSchema>;

interface SetupPageProps {
  interval?: SetupSearch["interval"];
  product?: SetupSearch["product"];
  purchase?: string;
  step?: SetupSearch["step"];
}

function initialWorkspaceName(): string {
  return "Team Workspace";
}

export function SetupPage({ interval, product, purchase }: SetupPageProps) {
  const session = useAtlasSession();
  const [purchaseIntent, setPurchaseIntent] = useState<PurchaseOnboardingIntent | null>(null);
  const [purchaseLookupFailed, setPurchaseLookupFailed] = useState(false);
  const selectedProduct = purchaseIntent?.product ?? product ?? DEFAULT_ONBOARDING_PRODUCT;
  const selectedInterval =
    purchaseIntent?.interval ?? interval ?? defaultOnboardingInterval(selectedProduct);
  const validSelection = isValidOnboardingSelection(selectedProduct, selectedInterval);
  const sessionData = session.data;
  const [workspaceName, setWorkspaceName] = useState(initialWorkspaceName());
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const purchaseId = purchaseIntent?.id ?? purchase ?? null;
  const productLabel = PRODUCT_LABELS[selectedProduct];
  const startRedirect = useMemo(
    () => buildOnboardingStartRedirect(selectedProduct, selectedInterval),
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
    (purchaseLookupFailed || (purchaseIntent !== null && !canUsePurchaseWorkspace(purchaseIntent)));

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
      try {
        const intent = await ensurePurchaseOnboarding({
          data: { product: selectedProduct, interval: selectedInterval },
        });
        if (!cancelled) {
          setPurchaseIntent(intent);
        }
      } catch (error) {
        // ensurePurchaseOnboarding refuses outright when the funnel is
        // closed. /onboarding is reachable directly and by bookmark, so the
        // disabled pricing buttons do not gate it, and without this the
        // rejection went to the console while the buyer watched a step that
        // never advanced.
        if (!cancelled) {
          // Only the guard's own wording is safe to show. Any other failure
          // here is internal and its message can name environment variables
          // or database state.
          const message = error instanceof Error ? error.message : "";
          setErrorMessage(
            isCheckoutRefusalMessage(message) ? message : "Atlas could not start that purchase.",
          );
        }
      }
    };
    void start();
    return () => {
      cancelled = true;
    };
  }, [purchase, purchaseIntent, selectedInterval, selectedProduct, sessionData, validSelection]);

  const attachActiveWorkspace = async (id: string, workspaceId: string) => {
    setErrorMessage(null);
    setIsPending(true);
    try {
      await attachPurchaseWorkspace({
        data: { purchaseId: id, workspaceId },
      }).then(setPurchaseIntent);
    } catch {
      setErrorMessage("Atlas could not attach that workspace. Try again.");
    } finally {
      setIsPending(false);
    }
  };

  const createWorkspaceForPurchase = async (id: string) => {
    setErrorMessage(null);
    setIsPending(true);
    try {
      const created = await createWorkspace({
        data: {
          name: workspaceName,
          slug: onboardingWorkspaceSlug(workspaceName),
          workspaceType: selectedProduct === "atlas_team" ? "team" : "individual",
        },
      });
      await attachPurchaseWorkspace({
        data: { purchaseId: id, workspaceId: created.id },
      }).then(setPurchaseIntent);
    } catch {
      setErrorMessage("Atlas could not create that workspace. Try another name.");
    } finally {
      setIsPending(false);
    }
  };

  const openStripeCheckout = async (id: string) => {
    setErrorMessage(null);
    setIsPending(true);
    try {
      const result = await startPurchaseCheckout({ data: { purchaseId: id } });
      window.location.assign(result.url);
    } catch {
      setErrorMessage("Atlas could not open Stripe checkout. Try again.");
      setIsPending(false);
    }
  };

  // Every action needs a purchase to act on, so without one there is no
  // handler at all rather than a handler that silently declines.
  const handleUseActiveWorkspace =
    purchaseId === null || activeWorkspace === null
      ? undefined
      : () => {
          void attachActiveWorkspace(purchaseId, activeWorkspace.id);
        };

  const handleCreateWorkspace =
    purchaseId === null
      ? undefined
      : (event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          void createWorkspaceForPurchase(purchaseId);
        };

  const handleCheckout =
    purchaseId === null
      ? undefined
      : () => {
          void openStripeCheckout(purchaseId);
        };

  const activeStep: PurchaseStepId =
    sessionData === null || sessionData === undefined || purchaseLookupPending
      ? "account"
      : !isReady
        ? "security"
        : workspaceAttached
          ? "payment"
          : "workspace";
  const alert = errorMessage ? (
    <p role="alert" className="type-body-medium bg-error-container rounded-2xl px-4 py-3">
      {errorMessage}
    </p>
  ) : null;

  let panel: ReactNode;
  if (!validSelection) {
    panel = (
      <PurchaseStepPanel
        description={`That billing interval is not available for ${productLabel}.`}
        eyebrow="Plan"
        title="Choose a billing option"
      >
        <Link to="/pricing" className="no-underline">
          <Button>View pricing</Button>
        </Link>
      </PurchaseStepPanel>
    );
  } else if (sessionData === undefined || purchaseLookupPending) {
    panel = (
      <PurchaseStepPanel
        description="Checking your account and selected plan."
        eyebrow="Account"
        title="Preparing your checkout"
      >
        <div className="bg-surface-container h-2 w-full overflow-hidden rounded-full">
          <div className="bg-primary h-full w-1/3 animate-pulse rounded-full" />
        </div>
      </PurchaseStepPanel>
    );
  } else if (sessionData === null) {
    panel = (
      <PurchaseStepPanel
        description="Create or open your account. Your selected plan stays with you."
        eyebrow="Step 1"
        title="Start with your account"
      >
        <div className="flex flex-wrap gap-3">
          <Link to="/sign-up" search={{ redirect: startRedirect }} className="no-underline">
            <Button size="lg">Create account</Button>
          </Link>
          <Link to="/sign-in" search={{ redirect: startRedirect }} className="no-underline">
            <Button variant="secondary" size="lg">
              Sign in
            </Button>
          </Link>
        </div>
      </PurchaseStepPanel>
    );
  } else if (purchaseUnavailable) {
    panel = (
      <PurchaseStepPanel
        description="This purchase link has expired or is no longer available."
        eyebrow="Plan"
        title="Purchase unavailable"
      >
        <Link to="/pricing" className="no-underline">
          <Button>View pricing</Button>
        </Link>
      </PurchaseStepPanel>
    );
  } else if (!isReady) {
    panel = (
      <PurchaseStepPanel
        description="Add the required passkey, then continue to the workspace step."
        eyebrow="Step 2"
        title="Secure your account"
      >
        <AccountSetupPage redirectTo={startRedirect} />
      </PurchaseStepPanel>
    );
  } else if (workspaceAttached) {
    panel = (
      <PurchaseStepPanel
        description={`Stripe will handle the payment details for ${productLabel}.`}
        eyebrow="Step 4"
        title="Continue to payment"
      >
        {alert}
        <Button onClick={handleCheckout} disabled={isPending || !purchaseId} size="lg">
          {isPending ? "Opening Stripe..." : "Continue to Stripe"}
        </Button>
      </PurchaseStepPanel>
    );
  } else {
    panel = (
      <PurchaseStepPanel
        description={
          selectedProduct === "atlas_team"
            ? "Name the team workspace this subscription belongs to."
            : "Choose the workspace this purchase belongs to."
        }
        eyebrow="Step 3"
        title={selectedProduct === "atlas_team" ? "Name your team workspace" : "Choose workspace"}
      >
        <div className="space-y-5">
          {alert}

          {canUseActiveWorkspace && activeWorkspace ? (
            // The purchase intent arrives from an effect after this step
            // renders, and the handler is undefined until it does.
            <Button
              onClick={handleUseActiveWorkspace}
              disabled={isPending || !handleUseActiveWorkspace}
              size="lg"
            >
              Use {activeWorkspace.name}
            </Button>
          ) : null}

          <form className="space-y-4" onSubmit={handleCreateWorkspace}>
            <Input
              label="Workspace name"
              value={workspaceName}
              onChange={setWorkspaceName}
              required
            />
            <Button type="submit" disabled={isPending || !purchaseId || !workspaceName.trim()}>
              {isPending ? "Saving..." : "Continue to payment"}
            </Button>
          </form>
        </div>
      </PurchaseStepPanel>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(12rem,18rem)_1fr]">
      <PurchaseStepRail
        activeStep={activeStep}
        authenticated={Boolean(sessionData)}
        interval={selectedInterval}
        productLabel={productLabel}
      />
      {panel}
    </div>
  );
}
