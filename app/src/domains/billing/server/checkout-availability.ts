import "@tanstack/react-start/server-only";

import { readBillingFlag } from "./billing-flags";
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
const HEALTHY_CACHE_MS = 30_000;
// A negative answer expires sooner than a positive one. One slow cold start
// should not refuse every sale for half a minute, and a genuinely down API
// gets re-probed cheaply.
const UNHEALTHY_CACHE_MS = 5_000;

let cachedProbe: CachedProbe | null = null;
// Concurrent callers share one probe. Without this a slow API gets a probe
// per request from the busiest anonymous route on the site.
let inFlightProbe: Promise<boolean> | null = null;

/**
 * Returns whether an operator has enabled the paid checkout funnel.
 *
 * Defaults to disabled. An operator who has not made a deliberate choice
 * should not be selling.
 *
 * @returns True when ATLAS_BILLING_CHECKOUT_ENABLED is "true".
 */
export function isCheckoutEnabled(): boolean {
  return readBillingFlag("ATLAS_BILLING_CHECKOUT_ENABLED", { whenUnset: false });
}

/**
 * Clears the memoized catalog probe.
 *
 * Exported for tests and for callers that need a probe after a known
 * deploy transition rather than up to PROBE_CACHE_MS later.
 */
export function resetCatalogProbeCache(): void {
  cachedProbe = null;
  inFlightProbe = null;
}

/**
 * Probes whether the Atlas API can serve directory results.
 *
 * A shallow /health check passes while the catalog is empty or the database
 * is unreachable, so this asks for one real entry instead. Any transport
 * error, non-200 status, or empty result set counts as unhealthy.
 *
 * @returns True when the API returned at least one catalog entry.
 */
export async function probeCatalogHealth(): Promise<boolean> {
  if (cachedProbe && cachedProbe.expiresAt > Date.now()) {
    return cachedProbe.healthy;
  }
  if (inFlightProbe) {
    return inFlightProbe;
  }

  inFlightProbe = runCatalogProbe()
    .then((healthy) => {
      // Sampled after the request, not before it, so a 2.5s probe does not
      // spend a tenth of its own cache window waiting.
      const ttl = healthy ? HEALTHY_CACHE_MS : UNHEALTHY_CACHE_MS;
      cachedProbe = { healthy, expiresAt: Date.now() + ttl };
      return healthy;
    })
    .finally(() => {
      inFlightProbe = null;
    });

  return inFlightProbe;
}

async function runCatalogProbe(): Promise<boolean> {
  let probeUrl: string;
  try {
    // Resolved outside the request try/catch. A missing
    // ATLAS_SERVER_API_PROXY_TARGET is a deployment fault, not a sick
    // catalog, and swallowing it silently reported "temporarily
    // unavailable" forever with nothing anywhere saying why.
    probeUrl = `${getServerApiBaseUrl({
      ATLAS_PUBLIC_URL: process.env.ATLAS_PUBLIC_URL,
      ATLAS_SERVER_API_PROXY_TARGET: process.env.ATLAS_SERVER_API_PROXY_TARGET,
    })}${PROBE_PATH}`;
  } catch (error) {
    console.error("Atlas checkout catalog probe is misconfigured.", error);
    return false;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(probeUrl, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      return false;
    }
    const payload: unknown = await response.json();
    return hasAtLeastOneEntry(payload);
  } catch (error) {
    // Failing closed is right; failing closed silently is not. Atlas has no
    // error reporting, so without this line "why can nobody buy" has no
    // answer anywhere.
    console.error("Atlas checkout catalog probe failed.", error);
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
