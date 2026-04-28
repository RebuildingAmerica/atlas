import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { atlasSessionQueryKey, useAtlasSession } from "@/domains/access/client/use-atlas-session";
import type { AtlasProduct } from "@/domains/access/capabilities";
import { PRODUCT_LABELS } from "@/domains/billing/product-labels";
import { Button } from "@/platform/ui/button";

const POLL_INTERVAL_MS = 1500;
const TIMEOUT_MS = 30_000;

const PRODUCT_FEATURES: Record<AtlasProduct, string[]> = {
  atlas_pro: [
    "Unlimited discovery runs",
    "Exports to CSV and JSON",
    "API key with 1,000 requests a day",
  ],
  atlas_team: [
    "Everything in Atlas Pro for your workspace",
    "Shared notes, watchlists, and Slack digests",
    "SSO and up to 50 members",
  ],
  atlas_research_pass: [
    "Unlimited discovery runs while your pass is active",
    "Exports and API access",
    "Shortlists and notes you keep after the pass ends",
  ],
};

interface CheckoutCompletePageProps {
  product?: AtlasProduct;
}

type Phase = "waiting" | "ready" | "timeout";

/**
 * Post-checkout landing surface.
 *
 * The user lands here from the payment screen on success. The webhook that
 * grants the purchased product is delivered out-of-band, so the row in
 * `workspace_products` may not exist yet when the page mounts. The page
 * polls the session until the purchased product appears in
 * `activeProducts`, then renders a welcome card that names what the
 * operator just unlocked and lets them choose to continue.
 */
export function CheckoutCompletePage({ product }: CheckoutCompletePageProps) {
  const queryClient = useQueryClient();
  const session = useAtlasSession();
  const [phase, setPhase] = useState<Phase>("waiting");
  const startedAtRef = useRef<number>(Date.now());

  const productLabel = product ? PRODUCT_LABELS[product] : "your purchase";
  const features = product ? PRODUCT_FEATURES[product] : [];
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

  if (phase === "timeout") {
    return (
      <div className="space-y-6 py-2">
        <div className="space-y-2">
          <p className="type-label-medium text-ink-muted tracking-wider uppercase">Checkout</p>
          <h1 className="type-display-small text-ink-strong leading-tight">Almost there</h1>
          <p className="type-body-large text-ink-soft leading-relaxed">
            We have your payment for {productLabel}, but Atlas hasn&apos;t finished setting it up
            yet — usually under a minute. Refresh in a moment, or email{" "}
            <a
              href="mailto:hello@rebuildingus.org"
              className="text-ink-strong hover:text-accent underline"
            >
              hello@rebuildingus.org
            </a>{" "}
            and we&apos;ll sort it out.
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
            <Button variant="secondary">Go to your account</Button>
          </Link>
        </div>
      </div>
    );
  }

  if (phase === "ready") {
    const isPass = product === "atlas_research_pass";
    const eyebrow = isPass ? "Your Research Pass is active" : `Welcome to ${productLabel}`;

    return (
      <div className="space-y-8 py-2">
        <div className="space-y-3">
          <p className="type-label-medium text-ink-muted tracking-wider uppercase">{eyebrow}</p>
          <h1 className="type-display-small text-ink-strong leading-tight">
            Thanks for backing Atlas.
          </h1>
          <p className="type-body-large text-ink-soft leading-relaxed">
            Your support helps us keep Atlas open and source-linked for everyone. Here&apos;s
            what&apos;s now available to you.
          </p>
        </div>

        {features.length > 0 ? (
          <ul className="type-body-medium text-ink-strong space-y-2">
            {features.map((feature) => (
              <li key={feature}>→ {feature}</li>
            ))}
          </ul>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <Link to="/discovery" className="no-underline">
            <Button variant="primary">Open your workspace</Button>
          </Link>
          <Link to="/account" className="no-underline">
            <Button variant="secondary">
              {isPass ? "View your account" : "Manage subscription"}
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 py-2">
      <div className="space-y-2">
        <p className="type-label-medium text-ink-muted tracking-wider uppercase">Checkout</p>
        <h1 className="type-display-small text-ink-strong leading-tight">Finishing up</h1>
        <p className="type-body-large text-ink-soft leading-relaxed">
          Atlas is enabling your {productLabel} access. This usually takes a moment.
        </p>
      </div>
    </div>
  );
}
