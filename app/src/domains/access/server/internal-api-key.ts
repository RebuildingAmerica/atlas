import "@tanstack/react-start/server-only";

import { timingSafeEqual } from "node:crypto";
import { verifyApiKeyResultSchema } from "./api-key-schema";
import { ensureAuthReady } from "./auth";
import { permissionsToScopes } from "../api-key-scopes";
import { getAuthRuntimeConfig } from "./runtime";

/**
 * Private app-to-API API-key verification endpoint.
 *
 * FastAPI uses this to verify direct API-key requests without treating those
 * keys as browser sessions inside the app.
 */
export async function introspectApiKeyRequest(request: Request) {
  const runtime = getAuthRuntimeConfig();
  const providedSecret = request.headers.get("x-atlas-internal-secret");
  const secretMatches =
    !!runtime.internalSecret &&
    !!providedSecret &&
    runtime.internalSecret.length === providedSecret.length &&
    timingSafeEqual(Buffer.from(runtime.internalSecret), Buffer.from(providedSecret));
  if (!secretMatches) {
    return Response.json(
      {
        valid: false,
      },
      { status: 401 },
    );
  }

  const apiKey = request.headers.get("x-api-key");
  if (!apiKey) {
    return Response.json(
      {
        valid: false,
      },
      { status: 400 },
    );
  }

  let result: ReturnType<typeof verifyApiKeyResultSchema.parse>;
  try {
    const auth = await ensureAuthReady();
    result = verifyApiKeyResultSchema.parse(
      await auth.api.verifyApiKey({
        body: {
          key: apiKey,
        },
      }),
    );
  } catch (error) {
    console.error("Atlas API key introspection failed.", error);
    throw error;
  }

  if (!result?.valid || !result.key) {
    return Response.json(
      {
        valid: false,
      },
      { status: 401 },
    );
  }

  return Response.json({
    keyId: result.key.id,
    name: result.key.name ?? "Atlas API Key",
    permissions: result.key.permissions ?? {},
    scopes: permissionsToScopes(result.key.permissions ?? {}),
    userEmail:
      typeof result.key.metadata?.userEmail === "string" ? result.key.metadata.userEmail : "",
    userId: result.key.referenceId,
    valid: true,
  });
}
