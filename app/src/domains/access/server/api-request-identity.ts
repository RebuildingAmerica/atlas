import "@tanstack/react-start/server-only";

import { getRequest } from "@tanstack/react-start/server";
import { setServerRequestHeadersProvider } from "@rebuildingamerica/atlas-api-client/orval/fetcher";
import { resolveClientIp } from "./anonymous-rate-limit";
import { getAuthRuntimeConfig } from "./runtime";

/**
 * Names the visitor to the Atlas API, signed with the shared internal secret.
 *
 * The API rate-limits anonymous callers by address. The app server calls it
 * from its own address, so without this header every visitor counts against
 * one bucket. The secret proves the address came from the app, not the caller.
 */
export function visitorIdentityHeaders(
  request: Request,
  internalSecret: string,
  trustedProxyHops: number,
): Record<string, string> {
  const clientIp = resolveClientIp(request, trustedProxyHops);
  if (!internalSecret || !clientIp) {
    return {};
  }
  return { "X-Atlas-Client-IP": clientIp, "X-Atlas-Proxy-Secret": internalSecret };
}

/** Makes every server-side Atlas API call carry the identity of the visitor it serves. */
export function registerApiRequestIdentity(): void {
  setServerRequestHeadersProvider(() => {
    const runtime = getAuthRuntimeConfig();
    return visitorIdentityHeaders(
      getRequest(),
      runtime.internalSecret,
      runtime.anonymousRateLimit.trustedProxyHops,
    );
  });
}
