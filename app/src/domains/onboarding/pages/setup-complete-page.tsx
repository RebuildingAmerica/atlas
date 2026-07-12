import { Link } from "@tanstack/react-router";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { atlasSessionQueryKey, useAtlasSession } from "@/domains/access/client/use-atlas-session";
import { loadPurchaseOnboarding } from "@/domains/billing/purchase-onboarding.functions";
import { PRODUCT_LABELS } from "@/domains/billing/product-labels";
import { Button } from "@/platform/ui/button";
import type { PurchaseIntentRecord } from "@/domains/billing/server/purchase-intents";

export const setupCompleteSearchSchema = z.object({
  purchase: z.string().optional(),
});

interface SetupCompletePageProps {
  purchase?: string;
}

type PurchaseCompletionIntent = PurchaseIntentRecord | null;

type Phase = "waiting" | "ready" | "timeout";

const POLL_INTERVAL_MS = 1500;
const TIMEOUT_MS = 30_000;

export const purchaseOnboardingIntentQueryKey = ["onboarding", "purchase-intent"] as const;

export function purchaseOnboardingIntentQueryOptions(purchaseId: string) {
  return queryOptions<PurchaseCompletionIntent>({
    queryKey: [...purchaseOnboardingIntentQueryKey, purchaseId],
    queryFn: () => loadPurchaseOnboarding({ data: { purchaseId } }),
  });
}

export function SetupCompletePage({ purchase }: SetupCompletePageProps) {
  const queryClient = useQueryClient();
  const session = useAtlasSession();
  const [phase, setPhase] = useState<Phase>("waiting");
  const startedAtRef = useRef(Date.now());
  const intentQuery = useQuery({
    ...purchaseOnboardingIntentQueryOptions(purchase ?? ""),
    enabled: Boolean(purchase),
  });
  const intent = intentQuery.data ?? null;
  const refetchIntent = intentQuery.refetch;

  const activeProducts = session.data?.workspace.activeProducts ?? [];
  const activeWorkspaceId = session.data?.workspace.activeOrganization?.id ?? null;
  const product = intent?.product ?? null;
  const productLabel = product ? PRODUCT_LABELS[product] : "your Atlas plan";
  const purchaseIsActive =
    Boolean(intent?.workspaceId) &&
    intent?.workspaceId === activeWorkspaceId &&
    product !== null &&
    activeProducts.includes(product);
  const purchaseIsComplete = intent?.status === "paid" || purchaseIsActive;

  useEffect(() => {
    if (!purchase) {
      return;
    }
    if (purchaseIsComplete) {
      setPhase("ready");
      return;
    }
    if (Date.now() - startedAtRef.current > TIMEOUT_MS) {
      setPhase("timeout");
      return;
    }
    const handle = window.setTimeout(() => {
      void refetchIntent();
      void queryClient.invalidateQueries({ queryKey: atlasSessionQueryKey });
    }, POLL_INTERVAL_MS);
    return () => {
      window.clearTimeout(handle);
    };
  }, [purchase, purchaseIsComplete, queryClient, refetchIntent, session.data]);

  if (!purchase) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <p className="type-label-medium text-outline">Payment</p>
        <h1 className="type-display-small text-on-surface">Payment link unavailable</h1>
        <p className="type-body-large text-outline">
          This payment link is missing purchase details.
        </p>
        <Link to="/pricing" className="no-underline">
          <Button>View pricing</Button>
        </Link>
      </div>
    );
  }

  if (phase === "ready") {
    const isTeam = product === "atlas_team";
    return (
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <div className="space-y-3">
          <p className="type-label-medium text-outline">{productLabel}</p>
          <h1 className="type-display-small text-on-surface">
            {isTeam ? "Your team workspace is ready." : "Thanks for backing Atlas."}
          </h1>
          <p className="type-body-large text-outline">
            {isTeam
              ? "Invite teammates or connect SSO when you are ready."
              : "Your workspace is ready."}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          {isTeam ? (
            <Link to="/organization/sso" className="no-underline">
              <Button>Set up SSO</Button>
            </Link>
          ) : null}
          <Link to="/discovery" className="no-underline">
            <Button variant={isTeam ? "secondary" : "primary"}>Open workspace</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <p className="type-label-medium text-outline">Payment</p>
      <h1 className="type-display-small text-on-surface">
        {phase === "timeout" ? "Almost there" : "Finishing setup"}
      </h1>
      <p className="type-body-large text-outline">
        {phase === "timeout"
          ? "Payment succeeded, but access has not appeared yet. Refresh in a moment."
          : "Stripe has not confirmed this payment yet."}
      </p>
      {phase === "timeout" ? (
        <div className="flex flex-wrap gap-3">
          <Button
            onClick={() => {
              window.location.reload();
            }}
          >
            Refresh
          </Button>
          {purchase ? (
            <Link to="/onboarding" search={{ purchase, step: "payment" }} className="no-underline">
              <Button variant="secondary">Return to payment</Button>
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
