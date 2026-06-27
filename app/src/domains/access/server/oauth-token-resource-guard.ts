import "@tanstack/react-start/server-only";

import { createHash } from "node:crypto";

const TOKEN_ENDPOINT_PATH = "/api/auth/oauth2/token";
const AUTHORIZATION_CODE_GRANT = "authorization_code";

interface VerificationRecord {
  value: string;
}

interface InternalAdapter {
  findVerificationValue(identifier: string): Promise<VerificationRecord | null>;
}

interface AuthContext {
  internalAdapter: InternalAdapter;
}

interface ReadyAuth {
  $context: Promise<AuthContext>;
}

interface StoredAuthorizationCodeValue {
  type?: unknown;
  query?: unknown;
}

interface TokenRequestFields {
  code: string | null;
  grantType: string | null;
  resource: string | null;
  resourceCount: number;
}

function oauthError(errorDescription: string): Response {
  return new Response(
    JSON.stringify({
      error: "invalid_request",
      error_description: errorDescription,
    }),
    {
      status: 400,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        pragma: "no-cache",
      },
    },
  );
}

function hashAuthorizationCode(code: string): string {
  return createHash("sha256").update(code).digest("base64url");
}

async function readTokenRequestFields(request: Request): Promise<TokenRequestFields | null> {
  const contentType = request.headers.get("content-type") ?? "";
  const body = await request.clone().text();

  if (contentType.includes("application/json")) {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    return {
      code: typeof parsed.code === "string" ? parsed.code : null,
      grantType: typeof parsed.grant_type === "string" ? parsed.grant_type : null,
      resource: typeof parsed.resource === "string" ? parsed.resource : null,
      resourceCount: typeof parsed.resource === "string" ? 1 : 0,
    };
  }

  if (
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType === "" ||
    body.includes("=")
  ) {
    const params = new URLSearchParams(body);
    const resources = params.getAll("resource");
    return {
      code: params.get("code"),
      grantType: params.get("grant_type"),
      resource: resources.at(0) ?? null,
      resourceCount: resources.length,
    };
  }

  return null;
}

function readStoredResource(value: string): string | null {
  const parsed = JSON.parse(value) as StoredAuthorizationCodeValue;
  if (
    parsed.type !== "authorization_code" ||
    typeof parsed.query !== "object" ||
    parsed.query === null
  ) {
    return null;
  }
  const query = parsed.query as Record<string, unknown>;
  return typeof query.resource === "string" ? query.resource : null;
}

function isTokenEndpoint(request: Request): boolean {
  const url = new URL(request.url);
  return request.method === "POST" && url.pathname === TOKEN_ENDPOINT_PATH;
}

/**
 * Prevent an authorization code minted for one OAuth resource from being
 * redeemed for another resource at the token endpoint.
 *
 * MCP clients must send the same RFC 8707 `resource` parameter during both
 * authorization and token exchange. Better Auth validates requested resources
 * against its allowlist, but Atlas adds this stricter code-bound comparison so
 * a code issued for `/mcp` cannot be exchanged for a sibling REST API token.
 */
export async function enforceOAuthTokenResourceConsistency(
  request: Request,
  auth: ReadyAuth,
): Promise<Response | null> {
  if (!isTokenEndpoint(request)) {
    return null;
  }

  let fields: TokenRequestFields | null;
  try {
    fields = await readTokenRequestFields(request);
  } catch {
    return null;
  }

  if (fields?.grantType !== AUTHORIZATION_CODE_GRANT || !fields.code) {
    return null;
  }
  if (fields.resourceCount > 1) {
    return oauthError("Token request must include exactly one resource parameter.");
  }

  const context = await auth.$context;
  const verification = await context.internalAdapter.findVerificationValue(
    hashAuthorizationCode(fields.code),
  );
  if (!verification) {
    return null;
  }

  let authorizationResource: string | null;
  try {
    authorizationResource = readStoredResource(verification.value);
  } catch {
    return null;
  }

  if (!authorizationResource && !fields.resource) {
    return null;
  }
  if (authorizationResource !== fields.resource) {
    return oauthError("Token request resource must match the authorization request resource.");
  }

  return null;
}
