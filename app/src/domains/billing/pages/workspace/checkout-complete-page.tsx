import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { atlasSessionQueryKey, useAtlasSession } from "@/domains/access/client/use-atlas-session";
import type { AtlasProduct } from "@/domains/access/capabilities";
import { Button } from "@/platform/ui/button";

const POLL_INTERVAL_MS = 1500;
const TIMEOUT_MS = 30_000;

const PRODUCT_LABELS: Record<AtlasProduct, string> = {
  atlas_pro: "Atlas Pro",
  atlas_team: "Atlas Team",
  atlas_research_pass: "Research Pass",
};

interface CheckoutCompletePageProps {
  product?: AtlasProduct;
}

type Phase = "waiting" | "ready" | "timeout";

/**
 * Post-Stripe-checkout landing surface.
 *
 * Stripe redirects here on a successful checkout. The webhook that grants
 * the purchased product is delivered out-of-band, so the row in
 * `workspace_products` may not exist yet when the user lands. This page
 * polls the session until the purchased product appears in
 * `activeProducts`, then redirects to /account.
 */
export function CheckoutCompletePage({ product }: CheckoutCompletePageProps) {
  const queryClient = useQueryClient();
  const session = useAtlasSession();
  const [phase, setPhase] = useState<Phase>("waiting");
  const startedAtRef = useRef<number>(Date.now());

  const productLabel = product ? PRODUCT_LABELS[product] : "your purchase";
  const sessionData = session.data;

  useEffect(() => {
    if (!product) {
      setPhase("ready");
      return;
    }

    const activeProducts = sessionData?.workspace.activeProducts ?? [];
    if (activeProducts.includes(product)) {
      setPhase("ready");
      return;
    }

    if (Date.now() - startedAtRef.current > TIMEOUT_MS) {
      setPhase("timeout");
      return;
    }

    const handle = window.setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: atlasSessionQueryKey });
    }, POLL_INTERVAL_MS);

    return () => {
      window.clearTimeout(handle);
    };
  }, [product, queryClient, sessionData]);

  useEffect(() => {
    if (phase !== "ready") {
      return;
    }
    const redirectHandle = window.setTimeout(() => {
      window.location.assign("/account");
    }, 800);
    return () => {
      window.clearTimeout(redirectHandle);
    };
  }, [phase]);

  if (phase === "timeout") {
    return (
      <div className="space-y-6 py-2">
        <div className="space-y-2">
          <p className="type-label-medium text-outline">Checkout</p>
          <h1 className="type-display-small text-on-surface">Almost there</h1>
          <p className="type-body-large text-outline">
            Stripe accepted your payment for {productLabel}, but Atlas hasn&apos;t finished
            provisioning the product yet. This usually clears in under a minute. You can refresh
            this page or visit your account; the product will appear as soon as the webhook is
            processed.
          </p>
        </div>
        <div className="flex gap-3">
          <Button
            onClick={() => {
              window.location.reload();
            }}
          >
            Refresh
          </Button>
          <Link to="/account">
            <Button variant="secondary">Go to account</Button>
          </Link>
        </div>
      </div>
    );
  }

  if (phase === "ready") {
    return (
      <div className="space-y-6 py-2">
        <div className="space-y-2">
          <p className="type-label-medium text-outline">Checkout</p>
          <h1 className="type-display-small text-on-surface">{productLabel} is active</h1>
          <p className="type-body-large text-outline">Taking you to your account&hellip;</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 py-2">
      <div className="space-y-2">
        <p className="type-label-medium text-outline">Checkout</p>
        <h1 className="type-display-small text-on-surface">Finalizing your purchase</h1>
        <p className="type-body-large text-outline">
          Stripe confirmed your payment for {productLabel}. Atlas is enabling your new
          capabilities&hellip;
        </p>
      </div>
    </div>
  );
}
