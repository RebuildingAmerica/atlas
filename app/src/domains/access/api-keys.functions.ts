import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  API_KEY_SCOPES,
  permissionsToScopes,
  scopesToPermissions,
  type ApiKeyScope,
} from "./api-key-scopes";
import { createdApiKeySchema, listedApiKeysResponseSchema } from "./server/api-key-schema";
import { ensureAuthReady } from "./server/auth";
import { getBrowserSessionHeaders } from "./server/request-headers";
import {
  getAuthRuntimeConfig,
  validateAuthRuntimeConfig,
  type AuthRuntimeConfig,
} from "./server/runtime";
import { requireAtlasSessionState, requireReadyAtlasSessionState } from "./server/session-state";

const API_KEY_PROVISIONING_RETRIES = 10;
const API_KEY_PROVISIONING_DELAY_MS = 100;
const apiKeyProvisioningSchema = z.object({
  valid: z.boolean(),
});

/**
 * The HTTP boundary Atlas can probe while a new API key finishes provisioning.
 */
interface ApiKeyProvisioningProbe {
  kind: "introspection" | "protected-api";
  url: string;
}

/**
 * Returns a promise that resolves after the requested delay.
 *
 * @param ms - The delay duration in milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Chooses the safest readiness probe for the new API key.
 *
 * `discovery:read` can be verified against the real protected API surface.
 * Other scope combinations fall back to the private introspection route.
 *
 * @param runtime - The resolved auth runtime config.
 * @param scopes - The scopes granted to the new API key.
 */
function resolveApiKeyProvisioningProbe(
  runtime: AuthRuntimeConfig,
  scopes: ApiKeyScope[],
): ApiKeyProvisioningProbe {
  if (scopes.includes("discovery:read")) {
    const apiBaseUrl = runtime.apiBaseUrl ?? runtime.publicBaseUrl;
    return {
      kind: "protected-api",
      url: new URL("/api/discovery-runs", apiBaseUrl).toString(),
    };
  }

  const introspectionUrl = runtime.apiKeyIntrospectionUrl;
  if (!introspectionUrl) {
    throw new Error(
      "ATLAS_AUTH_API_KEY_INTROSPECTION_URL is required when ATLAS_DEPLOY_MODE is not local.",
    );
  }

  return {
    kind: "introspection",
    url: introspectionUrl,
  };
}

/**
 * Checks whether the selected HTTP boundary already accepts the new API key.
 *
 * @param runtime - The resolved auth runtime config.
 * @param apiKey - The raw API key secret returned by Better Auth.
 * @param probe - The HTTP boundary Atlas should validate.
 */
async function canUseApiKeyProbe(
  runtime: AuthRuntimeConfig,
  apiKey: string,
  probe: ApiKeyProvisioningProbe,
): Promise<boolean> {
  const baseHeaders = {
    "x-api-key": apiKey,
  };

  if (probe.kind === "protected-api") {
    const responsePromise = fetch(probe.url, {
      headers: baseHeaders,
      method: "GET",
    });
    const response = await responsePromise;
    return response.ok;
  }

  const responsePromise = fetch(probe.url, {
    method: "POST",
    headers: {
      ...baseHeaders,
      "x-atlas-internal-secret": runtime.internalSecret,
    },
  });
  const response = await responsePromise;
  if (!response.ok) {
    return false;
  }

  const payloadPromise = response.json();
  const payload = apiKeyProvisioningSchema.parse(await payloadPromise);
  return payload.valid;
}

/**
 * Retries readiness checks until the new key is accepted by the target HTTP
 * boundary or Atlas exhausts the retry budget.
 *
 * @param runtime - The resolved auth runtime config.
 * @param apiKey - The raw API key secret returned by Better Auth.
 * @param scopes - The scopes granted to the new API key.
 */
async function confirmApiKeyProvisioning(
  runtime: AuthRuntimeConfig,
  apiKey: string,
  scopes: ApiKeyScope[],
): Promise<boolean> {
  const probe = resolveApiKeyProvisioningProbe(runtime, scopes);

  for (let attempt = 0; attempt < API_KEY_PROVISIONING_RETRIES; attempt += 1) {
    try {
      const canUseProbePromise = canUseApiKeyProbe(runtime, apiKey, probe);
      const canUseProbe = await canUseProbePromise;
      if (canUseProbe) {
        return true;
      }
    } catch {
      // A brand-new key can race the auth server's own write lifecycle. Retry
      // until the same HTTP boundary the operator will use accepts the key.
    }

    const sleepPromise = sleep(API_KEY_PROVISIONING_DELAY_MS);
    await sleepPromise;
  }

  return false;
}

/**
 * Creates one scoped API key for the current operator session.
 *
 * @param runtime - The resolved auth runtime config.
 * @param name - The operator-facing API-key label.
 * @param scopes - The scopes granted to the new API key.
 * @param userId - The Better Auth user id that owns the key.
 */
async function createScopedApiKey(
  runtime: AuthRuntimeConfig,
  name: string,
  scopes: ApiKeyScope[],
  userId: string,
) {
  const authPromise = ensureAuthReady();
  const auth = await authPromise;
  const createApiKeyPromise = auth.api.createApiKey({
    body: {
      name,
      permissions: scopesToPermissions(scopes),
      userId,
    },
  });
  const createdApiKey = createdApiKeySchema.parse(await createApiKeyPromise);

  if (createdApiKey.key) {
    const provisioningPromise = confirmApiKeyProvisioning(runtime, createdApiKey.key, scopes);
    const provisioningConfirmed = await provisioningPromise;
    if (!provisioningConfirmed) {
      console.warn("Atlas API key provisioning is still pending after creation.", {
        scopes,
        userId,
      });
    }
  }

  return createdApiKey;
}

/**
 * Lists API keys owned by the current operator session.
 *
 * Local mode returns an empty list because API keys are intentionally disabled
 * when auth is disabled.
 */
export const listApiKeys = createServerFn({ method: "GET" }).handler(async () => {
  const runtime = getAuthRuntimeConfig();
  if (runtime.localMode) {
    return [];
  }

  const sessionPromise = requireAtlasSessionState();
  await sessionPromise;
  const authPromise = ensureAuthReady();
  const auth = await authPromise;
  const listApiKeysPromise = auth.api.listApiKeys({
    headers: getBrowserSessionHeaders(),
  });
  const response = listedApiKeysResponseSchema.parse(await listApiKeysPromise);

  return response.apiKeys.map((apiKey) => ({
    ...apiKey,
    createdAt:
      typeof apiKey.createdAt === "string" ? apiKey.createdAt : apiKey.createdAt.toISOString(),
    prefix: apiKey.prefix ?? apiKey.start ?? null,
    scopes: permissionsToScopes(apiKey.permissions ?? null),
  }));
});

/**
 * Creates a new scoped API key for the current operator session.
 */
export const createApiKey = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      name: z.string().min(1),
      scopes: z.array(z.enum(API_KEY_SCOPES)).min(1),
    }),
  )
  .handler(async ({ data }) => {
    const runtime = getAuthRuntimeConfig();
    if (runtime.localMode) {
      throw new Error("API keys are unavailable while auth is disabled.");
    }
    validateAuthRuntimeConfig(runtime);

    const sessionPromise = requireReadyAtlasSessionState();
    const session = await sessionPromise;
    const createApiKeyPromise = createScopedApiKey(
      runtime,
      data.name,
      data.scopes,
      session.user.id,
    );
    const createdApiKey = await createApiKeyPromise;
    return createdApiKey;
  });

/**
 * Revokes an API key owned by the current operator session.
 */
export const deleteApiKey = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      keyId: z.string().min(1),
    }),
  )
  .handler(async ({ data }) => {
    const sessionPromise = requireAtlasSessionState();
    await sessionPromise;
    const authPromise = ensureAuthReady();
    const auth = await authPromise;
    const deleteApiKeyPromise = auth.api.deleteApiKey({
      body: {
        keyId: data.keyId,
      },
      headers: getBrowserSessionHeaders(),
    });
    return await deleteApiKeyPromise;
  });
