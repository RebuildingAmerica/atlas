import { Link } from "@tanstack/react-router";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { useAtlasSession } from "@/domains/access/client/use-atlas-session";
import { AccountSetupPage } from "@/domains/access/pages/auth/account-setup-page";
import { createWorkspace } from "@/domains/access/organizations.functions";
import {
  attachPurchaseWorkspace,
  ensurePurchaseOnboarding,
  loadPurchaseOnboarding,
  startPurchaseCheckout,
} from "@/domains/billing/purchase-onboarding.functions";
import { userFacingErrorMessage } from "@rebuildingamerica/atlas-api-client/user-facing-errors";
import { PRODUCT_LABELS } from "@/domains/billing/product-labels";
import { PurchaseStepPanel } from "./setup-page-steps";
import { Button, buttonStyles } from "@rebuildingamerica/atlas-ui/ui/button";
import { PaymentCommitment } from "@/domains/billing/components/payment-choice";
import { canManageAtlasOrganizationRole } from "@rebuildingamerica/atlas-access";
import { WorkspaceStep, type WorkspaceSubmission } from "./workspace-step";
import { PurchaseFlow, PurchaseFlowHeading } from "@/domains/billing/components/purchase-flow";
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

export function SetupPage({ interval, product, purchase }: SetupPageProps) {
  const session = useAtlasSession();
  const [purchaseIntent, setPurchaseIntent] = useState<PurchaseOnboardingIntent | null>(null);
  const [purchaseLookupFailed, setPurchaseLookupFailed] = useState(false);
  const selectedProduct = purchaseIntent?.product ?? product ?? DEFAULT_ONBOARDING_PRODUCT;
  const selectedInterval =
    purchaseIntent?.interval ?? interval ?? defaultOnboardingInterval(selectedProduct);
  const validSelection = isValidOnboardingSelection(selectedProduct, selectedInterval);
  const sessionData = session.data;
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
  const eligibleWorkspaces = sessionData
    ? sessionData.workspace.memberships
        .filter(
          (workspace) =>
            canManageAtlasOrganizationRole(workspace.role) &&
            (selectedProduct !== "atlas_team" || workspace.workspaceType === "team"),
        )
        .sort(
          (left, right) =>
            Number(right.id === activeWorkspace?.id) - Number(left.id === activeWorkspace?.id),
        )
    : [];
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
          setErrorMessage(userFacingErrorMessage(error, "Atlas could not start that purchase."));
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
      setErrorMessage("The workspace could not be selected. Try again.");
    } finally {
      setIsPending(false);
    }
  };

  const createWorkspaceForPurchase = async (id: string, workspaceName: string) => {
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
      setErrorMessage("The workspace could not be created. Try again.");
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
    } catch (error) {
      setErrorMessage(
        userFacingErrorMessage(error, "Atlas could not open Stripe checkout. Try again."),
      );
      setIsPending(false);
    }
  };

  // Every action needs a purchase to act on, so without one there is no
  // handler at all rather than a handler that silently declines.
  const handleWorkspaceSelection =
    purchaseId === null
      ? undefined
      : (selection: WorkspaceSubmission) => {
          if (selection.kind === "existing") {
            void attachActiveWorkspace(purchaseId, selection.workspaceId);
          } else {
            void createWorkspaceForPurchase(purchaseId, selection.name);
          }
        };

  const handleCheckout =
    purchaseId === null
      ? undefined
      : () => {
          void openStripeCheckout(purchaseId);
        };

  const alert = errorMessage ? (
    <p role="alert" className="type-body-medium bg-error-container rounded-2xl px-4 py-3">
      {errorMessage}{" "}
      <Link to="/pricing" className="underline">
        View plans
      </Link>
    </p>
  ) : null;

  let panel: ReactNode;
  if (!validSelection) {
    panel = (
      <PurchaseStepPanel
        description={`That billing interval is not available for ${productLabel}.`}
        title="Choose a billing option"
      >
        <Link to="/pricing" className={buttonStyles({})}>
          View pricing
        </Link>
      </PurchaseStepPanel>
    );
  } else if (sessionData === undefined || purchaseLookupPending) {
    panel = (
      <PurchaseStepPanel
        description="Checking your account and selected plan."
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
        productLabel={productLabel}
        title="Start with your account"
      >
        <div className="flex flex-wrap gap-3">
          <Link
            to="/sign-up"
            search={{ redirect: startRedirect }}
            className={buttonStyles({ size: "lg" })}
          >
            Create account
          </Link>
          <Link
            to="/sign-in"
            search={{ redirect: startRedirect }}
            className={buttonStyles({ variant: "secondary", size: "lg" })}
          >
            Sign in
          </Link>
        </div>
      </PurchaseStepPanel>
    );
  } else if (purchaseUnavailable) {
    panel = (
      <PurchaseStepPanel
        description="This purchase link has expired or is no longer available."
        title="Purchase unavailable"
      >
        <Link to="/pricing" className={buttonStyles({})}>
          View pricing
        </Link>
      </PurchaseStepPanel>
    );
  } else if (!isReady) {
    panel = (
      <PurchaseStepPanel
        description="Add the required passkey, then continue to the workspace step."
        title="Secure your account"
      >
        <AccountSetupPage redirectTo={startRedirect} />
      </PurchaseStepPanel>
    );
  } else if (workspaceAttached) {
    panel = (
      <PurchaseFlow
        header={
          <PurchaseFlowHeading
            productLabel={productLabel}
            title="Review your plan"
            description="Review the charge and renewal terms before payment."
          />
        }
        action={
          <Button
            className="w-full"
            onClick={handleCheckout}
            disabled={isPending || !purchaseId}
            size="lg"
          >
            {isPending ? "Opening checkout…" : "Continue to payment"}
          </Button>
        }
      >
        {alert}
        <PaymentCommitment product={selectedProduct} interval={selectedInterval} />
      </PurchaseFlow>
    );
  } else {
    panel = (
      <WorkspaceStep
        workspaces={eligibleWorkspaces}
        productLabel={productLabel}
        pending={isPending}
        error={alert}
        onContinue={handleWorkspaceSelection}
      />
    );
  }

  return <div className="flex w-full flex-1 flex-col">{panel}</div>;
}
