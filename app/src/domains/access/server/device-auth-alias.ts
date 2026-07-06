import { ensureAuthReady } from "@/domains/access/server/auth";

const BETTER_AUTH_DEVICE_BASE_PATH = "/api/auth/device" as const;

type DeviceAuthAliasEndpoint = "approve" | "code" | "deny" | "status" | "token";

type OAuthFormRequestBody = Record<string, string>;

const FORM_URLENCODED_CONTENT_TYPE = "application/x-www-form-urlencoded";
const JSON_CONTENT_TYPE = "application/json";

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
  return auth.handler(
    await rewriteDeviceAuthRequest(request, endpoint, internalDevicePath(endpoint)),
  );
}

function internalDevicePath(endpoint: DeviceAuthAliasEndpoint): string {
  return endpoint === "status"
    ? BETTER_AUTH_DEVICE_BASE_PATH
    : `${BETTER_AUTH_DEVICE_BASE_PATH}/${endpoint}`;
}

async function rewriteDeviceAuthRequest(
  request: Request,
  endpoint: DeviceAuthAliasEndpoint,
  pathname: string,
): Promise<Request> {
  const url = new URL(request.url);
  url.pathname = pathname;
  if (!shouldAdaptOAuthFormRequest(request, endpoint)) {
    return new Request(url, request);
  }

  return new Request(url, {
    body: JSON.stringify(await readOAuthFormBody(request)),
    headers: jsonForwardingHeaders(request),
    method: request.method,
  });
}

function shouldAdaptOAuthFormRequest(request: Request, endpoint: DeviceAuthAliasEndpoint): boolean {
  return (endpoint === "code" || endpoint === "token") && isFormUrlEncodedRequest(request);
}

function isFormUrlEncodedRequest(request: Request): boolean {
  const contentType = request.headers.get("content-type") ?? "";
  return contentType.toLowerCase().split(";")[0]?.trim() === FORM_URLENCODED_CONTENT_TYPE;
}

async function readOAuthFormBody(request: Request): Promise<OAuthFormRequestBody> {
  const formData = await request.formData();
  const body: OAuthFormRequestBody = {};
  for (const [parameter, value] of formData.entries()) {
    if (typeof value === "string") {
      body[parameter] = value;
    }
  }
  return body;
}

function jsonForwardingHeaders(request: Request): Headers {
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  headers.set("content-type", JSON_CONTENT_TYPE);
  headers.set("accept", JSON_CONTENT_TYPE);
  return headers;
}
