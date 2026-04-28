import type { AtlasProduct } from "@/domains/access/capabilities";

/**
 * localStorage key Atlas uses to remember a checkout that the operator
 * started but never completed.  The pricing page writes this immediately
 * before redirecting to Stripe; the workspace shell reads it to render a
 * "Resume your Atlas Team checkout" banner; the checkout-complete page
 * clears it once the purchased product activates.
 */
const PENDING_CHECKOUT_STORAGE_KEY = "atlas:pending-checkout";

/**
 * Maximum age of a pending-checkout record before Atlas treats it as stale
 * and stops surfacing the resume banner.  Twenty-four hours covers a
 * realistic "I got distracted, came back the next morning" window without
 * pestering an operator who deliberately abandoned the upgrade.
 */
const PENDING_CHECKOUT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Recorded checkout payload kept in localStorage between the pricing-page
 * click and the post-success landing.
 */
export interface PendingCheckoutRecord {
  interval: "monthly" | "yearly" | "once" | "weekly";
  product: AtlasProduct;
  startedAt: number;
}

interface RawPendingCheckoutRecord {
  interval?: unknown;
  product?: unknown;
  startedAt?: unknown;
}

const RECOGNISED_PRODUCTS: readonly AtlasProduct[] = [
  "atlas_pro",
  "atlas_team",
  "atlas_research_pass",
];
const RECOGNISED_INTERVALS: readonly PendingCheckoutRecord["interval"][] = [
  "monthly",
  "yearly",
  "once",
  "weekly",
];

function isRecognisedProduct(value: unknown): value is AtlasProduct {
  return typeof value === "string" && (RECOGNISED_PRODUCTS as readonly string[]).includes(value);
}

function isRecognisedInterval(value: unknown): value is PendingCheckoutRecord["interval"] {
  return typeof value === "string" && (RECOGNISED_INTERVALS as readonly string[]).includes(value);
}

/**
 * Reads the current pending-checkout record from localStorage, or returns
 * null when none is set, the payload is malformed, or the record has aged
 * past the TTL.
 */
export function readPendingCheckout(): PendingCheckoutRecord | null {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = window.localStorage.getItem(PENDING_CHECKOUT_STORAGE_KEY);
  if (!raw) {
    return null;
  }
  let parsed: RawPendingCheckoutRecord;
  try {
    parsed = JSON.parse(raw) as RawPendingCheckoutRecord;
  } catch {
    window.localStorage.removeItem(PENDING_CHECKOUT_STORAGE_KEY);
    return null;
  }
  if (
    !isRecognisedProduct(parsed.product) ||
    !isRecognisedInterval(parsed.interval) ||
    typeof parsed.startedAt !== "number"
  ) {
    window.localStorage.removeItem(PENDING_CHECKOUT_STORAGE_KEY);
    return null;
  }
  if (Date.now() - parsed.startedAt > PENDING_CHECKOUT_TTL_MS) {
    window.localStorage.removeItem(PENDING_CHECKOUT_STORAGE_KEY);
    return null;
  }
  return {
    interval: parsed.interval,
    product: parsed.product,
    startedAt: parsed.startedAt,
  };
}

/**
 * Records that the operator started checkout for one product so the
 * workspace shell can surface a Resume banner if they bail out before the
 * payment screen confirms.
 *
 * @param record - The product and interval the operator clicked.
 */
export function rememberPendingCheckout(record: Omit<PendingCheckoutRecord, "startedAt">): void {
  if (typeof window === "undefined") {
    return;
  }
  const payload: PendingCheckoutRecord = {
    interval: record.interval,
    product: record.product,
    startedAt: Date.now(),
  };
  window.localStorage.setItem(PENDING_CHECKOUT_STORAGE_KEY, JSON.stringify(payload));
}

/**
 * Removes the pending-checkout record once the purchased product has
 * activated in the operator's session, or when they explicitly dismiss the
 * resume banner.
 */
export function clearPendingCheckout(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(PENDING_CHECKOUT_STORAGE_KEY);
}
