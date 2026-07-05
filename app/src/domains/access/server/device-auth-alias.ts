import { ensureAuthReady } from "@/domains/access/server/auth";

const BETTER_AUTH_DEVICE_BASE_PATH = "/api/auth/device" as const;

type DeviceAuthAliasEndpoint = "approve" | "code" | "deny" | "status" | "token";

/**
 * Handles Atlas's canonical `/device/*` auth endpoints through Better Auth.
 *
 * @param request - Incoming request from the public Atlas device route.
 * @param endpoint - Canonical device endpoint being served.
 */
export async function handleDeviceAuthAlias(
  request: Request,
  endpoint: DeviceAuthAliasEndpoint,
): Promise<Response> {
  const auth = await ensureAuthReady();
  return auth.handler(rewriteDeviceAuthRequest(request, internalDevicePath(endpoint)));
}

function internalDevicePath(endpoint: DeviceAuthAliasEndpoint): string {
  return endpoint === "status"
    ? BETTER_AUTH_DEVICE_BASE_PATH
    : `${BETTER_AUTH_DEVICE_BASE_PATH}/${endpoint}`;
}

function rewriteDeviceAuthRequest(request: Request, pathname: string): Request {
  const url = new URL(request.url);
  url.pathname = pathname;
  return new Request(url, request);
}
