import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useAtlasSession } from "@/domains/access/client/use-atlas-session";
import {
  clearPendingCheckout,
  readPendingCheckout,
  type PendingCheckoutRecord,
} from "../pending-checkout";
import { PRODUCT_LABELS } from "../product-labels";

/**
 * Renders a one-line banner inviting the operator to finish a checkout they
 * started earlier when:
 *
 *   - localStorage has a pending-checkout record under the 24 h TTL,
 *   - the active workspace does not yet carry the purchased product, and
 *   - the operator has not dismissed the banner this session.
 *
 * The banner self-destructs once the purchased product appears on the
 * session, which lines up with the Stripe webhook delivering before the
 * operator returns from the success page.
 */
export function ResumeCheckoutBanner() {
  const session = useAtlasSession();
  const [pending, setPending] = useState<PendingCheckoutRecord | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setPending(readPendingCheckout());
  }, []);

  const activeProducts = session.data?.workspace.activeProducts ?? [];
  const productAlreadyActive = pending !== null && activeProducts.includes(pending.product);

  useEffect(() => {
    if (productAlreadyActive) {
      clearPendingCheckout();
      setPending(null);
    }
  }, [productAlreadyActive]);

  if (!pending || dismissed || productAlreadyActive) {
    return null;
  }

  return (
    <div className="border-outline-variant bg-surface-container-lowest mx-auto mt-4 flex w-full max-w-[88rem] flex-wrap items-center justify-between gap-3 rounded-2xl border px-5 py-3">
      <p className="type-body-medium text-on-surface">
        Pick up where you left off — you started a {PRODUCT_LABELS[pending.product]} checkout but
        didn't finish.
      </p>
      <div className="flex items-center gap-2">
        <Link
          to="/pricing"
          search={{ intent: pending.product, interval: pending.interval }}
          className="type-label-medium text-on-surface hover:underline"
        >
          Resume checkout &rarr;
        </Link>
        <button
          type="button"
          onClick={() => {
            clearPendingCheckout();
            setDismissed(true);
            setPending(null);
          }}
          aria-label="Dismiss resume-checkout banner"
          className="type-label-small text-outline hover:text-on-surface"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
