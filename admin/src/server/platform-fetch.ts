/**
 * How every platform API call leaves the admin: signed as the admin app,
 * carrying the operator's Cloudflare Access sign-in, and failing loudly with
 * the API's own explanation.
 */

import { getRequest } from "@tanstack/react-start/server";
import { loadAdminRuntime } from "./admin-runtime";
import { signAdminToken } from "./admin-token";
import { ACCESS_ASSERTION_HEADER, identifyOperator } from "./operator";

/** A refusal or failure from the Atlas API, with the sentence the operator should read. */
export class PlatformApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "PlatformApiError";
    this.status = status;
  }
}

interface ApiErrorBody {
  detail?: unknown;
}

const SIGN_IN_AGAIN = "Sign in again through Cloudflare Access.";

const NOT_JSON = "The Atlas API answered with something other than JSON.";

/**
 * Reads the API's JSON body. An error body that is not JSON reads as nothing,
 * so the status still explains it; a success body that is not JSON throws,
 * because showing it as empty data would hide a misrouted API.
 */
async function readBody(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    if (!response.ok) return undefined;
    throw new PlatformApiError(response.status, NOT_JSON);
  }
}

function detailOf(body: unknown, status: number): string {
  const detail = (body as ApiErrorBody | undefined)?.detail;
  return typeof detail === "string" && detail
    ? detail
    : `The Atlas API answered ${String(status)}.`;
}

/**
 * The generated client's fetcher: calls one platform route for the signed-in operator.
 *
 * @param url - The route path, such as `/api/platform/cloud-costs`.
 * @param options - The method, body and headers the generated client chose.
 */
export async function platformFetch<T>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const runtime = loadAdminRuntime();
  if (runtime instanceof Error) {
    throw new PlatformApiError(
      503,
      "The Atlas platform admin is not configured.",
    );
  }
  const operator = await identifyOperator(getRequest(), runtime);
  if (!operator.ok) throw new PlatformApiError(403, SIGN_IN_AGAIN);

  const target = new URL(url, runtime.env.apiOrigin);
  if (
    target.origin !== runtime.env.apiOrigin ||
    target.username ||
    target.password ||
    !/^\/api\/platform(?:\/|$)/.test(target.pathname) ||
    /%(?:2f|5c)/i.test(target.pathname)
  )
    throw new PlatformApiError(
      403,
      "The requested platform API route is not allowed.",
    );
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  headers.set(
    "Authorization",
    `Bearer ${await signAdminToken(runtime.env, operator.email, Date.now())}`,
  );
  headers.delete(ACCESS_ASSERTION_HEADER);
  if (operator.assertion)
    headers.set(ACCESS_ASSERTION_HEADER, operator.assertion);

  const request = new Request(target, {
    ...options,
    headers,
    redirect: "manual",
  });
  // The private binding preserves both proofs of the operator's identity;
  // redirects cannot forward them beyond the trusted platform API routes.
  let response: Response;
  if (runtime.development) response = await fetch(request);
  else {
    if (!runtime.apiRuntime)
      throw new PlatformApiError(
        503,
        "The Atlas platform admin is not configured.",
      );
    response = await runtime.apiRuntime
      .getByName("application", { locationHint: "enam" })
      .fetch(request);
  }
  const body = await readBody(response);
  if (!response.ok)
    throw new PlatformApiError(
      response.status,
      detailOf(body, response.status),
    );
  return body as T;
}
