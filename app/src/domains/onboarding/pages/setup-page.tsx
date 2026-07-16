import { Link } from "@tanstack/react-router";
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
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
import { Button } from "@rebuildingamerica/atlas-ui/ui/button";
import { Input } from "@rebuildingamerica/atlas-ui/ui/input";
import { cn } from "@/lib/utils";

const DEFAULT_PRODUCT = "atlas_team";

export const setupSearchSchema = z.object({
  interval: z.enum(["monthly", "yearly", "four_month", "once", "weekly"]).optional(),
  product: z.enum(["atlas_pro", "atlas_team", "atlas_research_pass"]).optional(),
  purchase: z.string().optional(),
  step: z.enum(["payment"]).optional(),
});

type SetupSearch = z.infer<typeof setupSearchSchema>;
type SetupProduct = NonNullable<SetupSearch["product"]>;
type SetupInterval = NonNullable<SetupSearch["interval"]>;

interface PurchaseOnboardingIntent {
  expiresAt: string;
  id: string;
  interval: SetupInterval;
  product: SetupProduct;
  status: string;
  stripeCheckoutSessionId: string | null;
  userId: string;
  workspaceId: string | null;
}

interface SetupPageProps {
  interval?: SetupSearch["interval"];
  product?: SetupSearch["product"];
  purchase?: string;
  step?: SetupSearch["step"];
}

function buildStartRedirect(product: string, interval: string): string {
  const params = new URLSearchParams({ product, interval });
  return `/onboarding?${params.toString()}`;
}

function defaultIntervalForProduct(product: SetupProduct) {
  return product === "atlas_research_pass" ? "once" : "monthly";
}

function isValidProductInterval(product: SetupProduct, interval: SetupInterval): boolean {
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

type PurchaseStepId = "account" | "security" | "workspace" | "payment";

interface PurchaseStep {
  description: string;
  id: PurchaseStepId;
  title: string;
}

const PURCHASE_STEPS: readonly PurchaseStep[] = [
  {
    description: "Create or open your account.",
    id: "account",
    title: "Account",
  },
  {
    description: "Add the required passkey.",
    id: "security",
    title: "Security",
  },
  {
    description: "Choose where the plan belongs.",
    id: "workspace",
    title: "Workspace",
  },
  {
    description: "Finish with Stripe.",
    id: "payment",
    title: "Payment",
  },
];

function stepIndex(step: PurchaseStepId): number {
  return PURCHASE_STEPS.findIndex((item) => item.id === step);
}

function PurchaseStepRail({
  activeStep,
  authenticated,
  interval,
  productLabel,
}: {
  activeStep: PurchaseStepId;
  authenticated: boolean;
  interval: SetupInterval;
  productLabel: string;
}) {
  const activeIndex = stepIndex(activeStep);
  return (
    <aside
      className={cn(
        "border-outline-variant bg-surface-container-lowest overflow-hidden rounded-3xl border transition-all duration-500 ease-out",
        authenticated ? "lg:max-w-[16rem]" : "lg:max-w-[23rem]",
      )}
    >
      <div
        className={cn(
          "space-y-6 p-5 transition-all duration-500",
          authenticated ? "lg:p-4" : "lg:p-6",
        )}
      >
        <div className="space-y-2">
          <p className="type-label-medium text-outline">Selected plan</p>
          <h1
            className={cn(
              "text-on-surface transition-all duration-500",
              authenticated ? "type-title-large" : "type-display-small",
            )}
          >
            {productLabel}
          </h1>
          <p className="type-body-medium text-outline">Billing: {interval}</p>
        </div>

        <ol className="space-y-3">
          {PURCHASE_STEPS.map((step, index) => {
            const complete = index < activeIndex;
            const active = step.id === activeStep;
            return (
              <li
                key={step.id}
                className={cn(
                  "rounded-2xl border px-3 py-3 transition-all duration-300",
                  active
                    ? "border-primary bg-primary-container text-on-primary-container"
                    : "border-outline-variant bg-surface text-on-surface",
                  complete && "bg-surface-container-low text-outline",
                )}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={cn(
                      "type-label-medium flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-colors",
                      active
                        ? "border-on-primary-container bg-on-primary-container text-primary-container"
                        : complete
                          ? "border-outline bg-outline text-surface"
                          : "border-outline-variant text-outline",
                    )}
                    aria-hidden="true"
                  >
                    {complete ? "✓" : index + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="type-label-large block">{step.title}</span>
                    <span
                      className={cn(
                        "type-body-small text-outline block transition-opacity duration-300",
                        authenticated && !active ? "lg:opacity-0" : "opacity-100",
                      )}
                    >
                      {step.description}
                    </span>
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </aside>
  );
}

function PurchaseStepPanel({
  children,
  description,
  eyebrow,
  title,
}: {
  children: ReactNode;
  description: string;
  eyebrow: string;
  title: string;
}) {
  return (
    <section className="border-outline-variant bg-surface-container-lowest min-h-[32rem] rounded-3xl border p-6 shadow-[0_24px_80px_rgba(26,22,18,0.08)] sm:p-8">
      <div className="mx-auto flex min-h-[28rem] w-full max-w-2xl flex-col justify-center space-y-8">
        <div className="space-y-3">
          <p className="type-label-medium text-outline">{eyebrow}</p>
          <h2 className="type-display-small text-on-surface">{title}</h2>
          <p className="type-body-large text-outline">{description}</p>
        </div>
        {children}
      </div>
    </section>
  );
}

export function SetupPage({ interval, product, purchase }: SetupPageProps) {
  const session = useAtlasSession();
  const [purchaseIntent, setPurchaseIntent] = useState<PurchaseOnboardingIntent | null>(null);
  const [purchaseLookupFailed, setPurchaseLookupFailed] = useState(false);
  const selectedProduct = purchaseIntent?.product ?? product ?? DEFAULT_PRODUCT;
  const selectedInterval =
    purchaseIntent?.interval ?? interval ?? defaultIntervalForProduct(selectedProduct);
  const validSelection = isValidProductInterval(selectedProduct, selectedInterval);
  const sessionData = session.data;
  const [workspaceName, setWorkspaceName] = useState(initialWorkspaceName());
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

  const handleCreateWorkspace = async (event: FormEvent<HTMLFormElement>) => {
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
          slug: slugify(workspaceName),
          workspaceType: selectedProduct === "atlas_team" ? "team" : "individual",
        },
      });
      await attachPurchaseWorkspace({
        data: { purchaseId, workspaceId: created.id },
      }).then(setPurchaseIntent);
    } catch {
      setErrorMessage("Atlas could not create that workspace. Try another name.");
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
        <Button onClick={() => void handleCheckout()} disabled={isPending || !purchaseId} size="lg">
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
            <Button onClick={() => void handleUseActiveWorkspace()} disabled={isPending} size="lg">
              Use {activeWorkspace.name}
            </Button>
          ) : null}

          <form className="space-y-4" onSubmit={(event) => void handleCreateWorkspace(event)}>
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
