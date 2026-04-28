import "@tanstack/react-start/server-only";

import {
  ClientIdMetadataError,
  DEFAULT_CIMD_RESOLVER_OPTIONS,
  isClientIdMetadataDocumentUrl,
  resolveClientIdMetadataDocument,
  type ClientIdMetadataResolverOptions,
} from "./client-id-metadata";
import { upsertCimdClientPg, upsertCimdClientSqlite } from "./cimd-sync";
import { getAuthDatabase, getAuthPgPool } from "./auth";

/**
 * Routes BetterAuth's `oauthProvider` plugin requires us to inspect for a
 * URL-shaped `client_id` so the synthetic CIMD row is in place before the
 * plugin looks the client up.
 */
const CIMD_INTERCEPT_PATHS = [
  "/api/auth/oauth2/authorize",
  "/api/auth/oauth2/par",
  "/api/auth/oauth2/token",
  "/api/auth/oauth2/public-client",
  "/api/auth/oauth2/public-client-prelogin",
] as const;

/**
 * Result of the CIMD pre-handler.
 *
 * - `request` is the (possibly cloned-and-rebuilt) request to forward to the
 *   downstream BetterAuth handler.  POST request bodies are consumed once
 *   to look up `client_id`, so this field hands the caller a fresh Request
 *   they can read again.
 * - `errorResponse` is set when CIMD resolution failed; the caller should
 *   short-circuit and return it.
 */
export interface CimdHandlerOutcome {
  request: Request;
  errorResponse: Response | null;
}

interface CimdRequestParts {
  url: URL;
  /** A request whose body has not been consumed yet, ready to forward. */
  forwardRequest: Request;
  clientId: string | undefined;
}

async function readRequestParts(request: Request): Promise<CimdRequestParts> {
  const url = new URL(request.url);

  if (request.method === "GET" || request.method === "HEAD") {
    return {
      url,
      forwardRequest: request,
      clientId: url.searchParams.get("client_id") ?? undefined,
    };
  }

  // POST/PUT/PATCH/DELETE: clone before reading so the original body stream
  // remains available for the downstream BetterAuth handler.
  const contentType = request.headers.get("content-type") ?? "";
  const body = await request.clone().text();

  let clientId: string | undefined;
  if (contentType.includes("application/x-www-form-urlencoded")) {
    clientId = new URLSearchParams(body).get("client_id") ?? undefined;
  } else if (contentType.includes("application/json")) {
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      const raw = parsed?.client_id;
      clientId = typeof raw === "string" ? raw : undefined;
    } catch {
      clientId = undefined;
    }
  }

  // Rebuild the request because `request.clone()` already consumed the
  // original body in some runtimes when both are read concurrently.
  const forwardRequest = new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body,
    redirect: request.redirect,
  });

  return { url, forwardRequest, clientId };
}

function shouldIntercept(url: URL): boolean {
  return CIMD_INTERCEPT_PATHS.some((path) => url.pathname === path);
}

function errorResponse(error: ClientIdMetadataError): Response {
  return new Response(
    JSON.stringify({
      error: "invalid_client",
      error_description: error.message,
    }),
    {
      status: error.code === "fetch_failed" ? 502 : 400,
      headers: { "content-type": "application/json; charset=utf-8" },
    },
  );
}

/**
 * Pre-handler that materializes the synthetic Better Auth oauthClient row
 * from a Client ID Metadata Document before BetterAuth's oauthProvider
 * plugin processes the request.
 *
 * @param request - The incoming request to inspect.
 * @param options - Resolver options sourced from the Atlas runtime config.
 */
export async function handleCimdRequest(
  request: Request,
  options: ClientIdMetadataResolverOptions = DEFAULT_CIMD_RESOLVER_OPTIONS,
): Promise<CimdHandlerOutcome> {
  const { url, forwardRequest, clientId } = await readRequestParts(request);

  if (!shouldIntercept(url) || !clientId || !isClientIdMetadataDocumentUrl(clientId)) {
    return { request: forwardRequest, errorResponse: null };
  }

  let document;
  try {
    document = await resolveClientIdMetadataDocument(clientId, options);
  } catch (error) {
    if (error instanceof ClientIdMetadataError) {
      return { request: forwardRequest, errorResponse: errorResponse(error) };
    }
    throw error;
  }

  const pool = getAuthPgPool();
  if (pool) {
    await upsertCimdClientPg(pool, document);
  } else {
    const database = getAuthDatabase();
    if (!database) {
      throw new Error("CIMD upsert: neither Postgres pool nor SQLite database is available.");
    }
    upsertCimdClientSqlite(database, document);
  }

  return { request: forwardRequest, errorResponse: null };
}
