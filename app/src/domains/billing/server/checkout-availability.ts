import "@tanstack/react-start/server-only";

import { getServerApiBaseUrl } from "@/platform/config/app-config";

/**
 * Why a checkout attempt was refused, or `null` when checkout may proceed.
 *
 * `disabled` means an operator turned the funnel off. `catalog_unavailable`
 * means the Atlas API could not serve directory results, so a buyer would pay
 * for a product that cannot answer a query.
 */
export type CheckoutBlockReason = "disabled" | "catalog_unavailable";

export interface CheckoutAvailability {
  available: boolean;
  reason: CheckoutBlockReason | null;
}

interface CachedProbe {
  healthy: boolean;
  expiresAt: number;
}

const PROBE_PATH = "/entities?limit=1";
const PROBE_TIMEOUT_MS = 2500;
const PROBE_CACHE_MS = 30_000;

let cachedProbe: CachedProbe | null = null;

/**
 * Returns whether an operator has enabled the paid checkout funnel.
 *
 * Defaults to disabled. An operator who has not made a deliberate choice
 * should not be selling, and the repo forbids silent permissive defaults.
 *
 * @returns True only when ATLAS_BILLING_CHECKOUT_ENABLED is exactly "true".
 */
export function isCheckoutEnabled(): boolean {
  return process.env.ATLAS_BILLING_CHECKOUT_ENABLED?.trim().toLowerCase() === "true";
}

/**
 * Clears the memoized catalog probe.
 *
 * Exported for tests and for callers that need a probe after a known
 * deploy transition rather than up to PROBE_CACHE_MS later.
 */
export function resetCatalogProbeCache(): void {
  cachedProbe = null;
}

/**
 * Probes whether the Atlas API can serve directory results.
 *
 * A shallow /health check passes while the catalog is empty or the database
 * is unreachable, so this asks for one real entry instead. Any transport
 * error, non-200 status, or empty result set counts as unhealthy.
 *
 * @param now - Current epoch milliseconds, injectable for tests.
 * @returns True when the API returned at least one catalog entry.
 */
export async function probeCatalogHealth(now: number = Date.now()): Promise<boolean> {
  if (cachedProbe && cachedProbe.expiresAt > now) {
    return cachedProbe.healthy;
  }

  const healthy = await runCatalogProbe();
  cachedProbe = { healthy, expiresAt: now + PROBE_CACHE_MS };
  return healthy;
}

async function runCatalogProbe(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(`${getServerApiBaseUrl()}${PROBE_PATH}`, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      return false;
    }
    const payload: unknown = await response.json();
    return hasAtLeastOneEntry(payload);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function hasAtLeastOneEntry(payload: unknown): boolean {
  if (Array.isArray(payload)) {
    return payload.length > 0;
  }
  if (payload && typeof payload === "object" && "items" in payload) {
    const { items } = payload;
    return Array.isArray(items) && items.length > 0;
  }
  return false;
}

/**
 * Resolves whether a buyer may start checkout right now.
 *
 * The operator switch is checked first so a deliberate shutdown never
 * spends a network round trip on the catalog probe.
 *
 * @returns Availability with the blocking reason when checkout is refused.
 */
export async function resolveCheckoutAvailability(): Promise<CheckoutAvailability> {
  if (!isCheckoutEnabled()) {
    return { available: false, reason: "disabled" };
  }
  if (!(await probeCatalogHealth())) {
    return { available: false, reason: "catalog_unavailable" };
  }
  return { available: true, reason: null };
}
