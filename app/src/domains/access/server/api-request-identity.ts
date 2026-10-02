import "@tanstack/react-start/server-only";

import { getRequest } from "@tanstack/react-start/server";
import { setServerRequestHeadersProvider } from "@rebuildingamerica/atlas-api-client/orval/fetcher";
import { resolveClientIp } from "./anonymous-rate-limit";
import { getAuthRuntimeConfig } from "./runtime";

/**
 * Names the visitor to the Atlas API, vouched for with the edge origin secret.
 *
 * The API rate-limits anonymous callers by address. The app server calls it
 * from its own address, so without this header every visitor counts against
 * one bucket. The secret proves the address came from the app, not the caller.
 * It is the same low-privilege secret the Cloudflare edge uses: it chooses a
 * rate-limit bucket and nothing more.
 */
export function visitorIdentityHeaders(
  request: Request,
  edgeOriginSecret: string,
  trustedProxyHops: number,
): Record<string, string> {
  const clientIp = resolveClientIp(request, trustedProxyHops);
  if (!edgeOriginSecret || !clientIp) {
    return {};
  }
  return { "X-Atlas-Client-IP": clientIp, "X-Atlas-Proxy-Secret": edgeOriginSecret };
}

/** Makes every server-side Atlas API call carry the identity of the visitor it serves. */
export function registerApiRequestIdentity(): void {
  setServerRequestHeadersProvider(() => {
    const runtime = getAuthRuntimeConfig();
    return visitorIdentityHeaders(
      getRequest(),
      runtime.edgeOriginSecret,
      runtime.anonymousRateLimit.trustedProxyHops,
    );
  });
}
