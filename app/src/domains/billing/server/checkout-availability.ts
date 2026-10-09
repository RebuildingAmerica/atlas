import "@tanstack/react-start/server-only";

import { readBillingFlag } from "./billing-flags";
import { getServerApiBaseUrl } from "@/platform/config/app-config";
import { getAllowedBillingOffers } from "./billing-offers";

/**
 * Why a checkout attempt was refused, or `null` when checkout may proceed.
 *
 * `disabled` means an operator turned the funnel off in the deployment's
 * settings. `paused` means the platform operator paused sales with the
 * checkout switch. `catalog_unavailable` means the Atlas API could not serve
 * directory results, so a buyer would pay for a product that cannot answer a
 * query.
 */
export type CheckoutBlockReason = "disabled" | "paused" | "catalog_unavailable";

export interface CheckoutAvailability {
  available: boolean;
  reason: CheckoutBlockReason | null;
  allowedOffers: string[];
}

interface CachedProbe {
  healthy: boolean;
  expiresAt: number;
}

interface CachedCheck {
  /** Returns the cached answer, or asks the API once for every waiting caller. */
  read: () => Promise<boolean>;
  reset: () => void;
}

const PROBE_PATH = "/entities?limit=1";
const SERVICE_STATUS_PATH = "/service-status";
const PROBE_TIMEOUT_MS = 2500;
const HEALTHY_CACHE_MS = 30_000;
// A negative answer expires sooner than a positive one. One slow cold start
// should not refuse every sale for half a minute, and a genuinely down API
// gets re-probed cheaply.
const UNHEALTHY_CACHE_MS = 5_000;

/**
 * Wraps an API check in the cache every checkout probe needs.
 *
 * Concurrent callers share one request. Without this a slow API gets a probe
 * per request from the busiest anonymous route on the site.
 */
function cachedCheck(run: () => Promise<boolean>): CachedCheck {
  let cached: CachedProbe | null = null;
  let inFlight: Promise<boolean> | null = null;
  return {
    read() {
      if (cached && cached.expiresAt > Date.now()) {
        return Promise.resolve(cached.healthy);
      }
      if (inFlight) {
        return inFlight;
      }
      inFlight = run()
        .then((healthy) => {
          // Sampled after the request, not before it, so a 2.5s probe does not
          // spend a tenth of its own cache window waiting.
          const ttl = healthy ? HEALTHY_CACHE_MS : UNHEALTHY_CACHE_MS;
          cached = { healthy, expiresAt: Date.now() + ttl };
          return healthy;
        })
        .finally(() => {
          inFlight = null;
        });
      return inFlight;
    },
    reset() {
      cached = null;
      inFlight = null;
    },
  };
}

const catalogCheck = cachedCheck(runCatalogProbe);
const checkoutSwitchCheck = cachedCheck(runCheckoutSwitchProbe);

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
 * Clears the memoized checkout probes.
 *
 * Exported for tests and for callers that need a probe after a known
 * deploy transition rather than up to HEALTHY_CACHE_MS later.
 */
export function resetCatalogProbeCache(): void {
  catalogCheck.reset();
  checkoutSwitchCheck.reset();
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
export function probeCatalogHealth(): Promise<boolean> {
  return catalogCheck.read();
}

/**
 * Asks the Atlas API whether the platform operator has paused sales.
 *
 * Any failure counts as paused: selling while the switch cannot be read
 * could take money the operator meant to stop.
 *
 * @returns True when checkout is open.
 */
export function probeCheckoutOpen(): Promise<boolean> {
  return checkoutSwitchCheck.read();
}

function runCatalogProbe(): Promise<boolean> {
  return runApiProbe(PROBE_PATH, "catalog", hasAtLeastOneEntry);
}

function runCheckoutSwitchProbe(): Promise<boolean> {
  return runApiProbe(SERVICE_STATUS_PATH, "checkout switch", isCheckoutOpen);
}

async function runApiProbe(
  path: string,
  label: string,
  accepts: (payload: unknown) => boolean,
): Promise<boolean> {
  let probeUrl: string;
  try {
    // Resolved outside the request try/catch. A missing
    // ATLAS_SERVER_API_PROXY_TARGET is a deployment fault, not a sick
    // catalog, and swallowing it silently reported "temporarily
    // unavailable" forever with nothing anywhere saying why.
    probeUrl = `${getServerApiBaseUrl({
      ATLAS_PUBLIC_URL: process.env.ATLAS_PUBLIC_URL,
      ATLAS_SERVER_API_PROXY_TARGET: process.env.ATLAS_SERVER_API_PROXY_TARGET,
    })}${path}`;
  } catch (error) {
    console.error(`Atlas checkout ${label} probe is misconfigured.`, error);
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
    return accepts(payload);
  } catch (error) {
    // Failing closed is right; failing closed silently is not. Atlas has no
    // error reporting, so without this line "why can nobody buy" has no
    // answer anywhere.
    console.error(`Atlas checkout ${label} probe failed.`, error);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function isCheckoutOpen(payload: unknown): boolean {
  return (
    payload !== null &&
    typeof payload === "object" &&
    "checkout_open" in payload &&
    payload.checkout_open === true
  );
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
    return { available: false, reason: "disabled", allowedOffers: [] };
  }
  const allowedOffers = getAllowedBillingOffers();
  if (allowedOffers.length === 0) {
    return { available: false, reason: "disabled", allowedOffers: [] };
  }
  const [checkoutOpen, catalogHealthy] = await Promise.all([
    probeCheckoutOpen(),
    probeCatalogHealth(),
  ]);
  if (!checkoutOpen) {
    return { available: false, reason: "paused", allowedOffers: [] };
  }
  if (!catalogHealthy) {
    return { available: false, reason: "catalog_unavailable", allowedOffers: [] };
  }
  return { available: true, reason: null, allowedOffers };
}
