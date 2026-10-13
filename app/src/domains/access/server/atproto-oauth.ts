import { fetchAtlasApiResponse } from "@rebuildingamerica/atlas-api-client/orval/fetcher";
import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import { Agent } from "@atproto/api";
import { NodeOAuthClient, type OAuthClientOptions } from "@atproto/oauth-client-node";
import { UserFacingError } from "@rebuildingamerica/atlas-api-client/user-facing-errors";
import {
  createAtprotoOAuthStores,
  pruneAtprotoOAuthStores as pruneAtprotoOAuthStoreRows,
} from "./atproto-oauth-stores";
import { provisionManagedAtprotoIdentity } from "./atproto-pds";
import { createAppActorHeaders } from "./app-actor-assertion";
import { createAtprotoSessionForUser } from "./atproto-sign-in";
import { loadAtlasSession } from "./session-state";
import { getAuthRuntimeConfig } from "./runtime";
import { requestResource } from "../../../../server/request-scope";

interface LinkedAtprotoIdentity {
  current_handle: string;
  did: string;
  id: string;
  pds_url: string | null;
}

interface AtprotoAuthorizationInput {
  handle: string;
  returnTo: string;
}

interface ResolvedAtprotoIdentityInput {
  did: string;
  handle: string;
}

interface LinkedAtprotoIdentityInput {
  current_handle: string;
  did: string;
  pds_url: string | null;
}

interface RecoverableAtprotoOAuthError extends Error {
  attemptedHandle: string;
  returnTo: string;
}

export type AtprotoReturnContext =
  { kind: "account" } | { kind: "claim"; slug: string } | { kind: "manage"; slug: string };

const metadataPath = "/api/atproto/oauth/client-metadata.json";
const callbackPath = "/api/atproto/oauth/callback";

const { appStateStore, sessionStore, stateStore } = createAtprotoOAuthStores();

let clientPromise: Promise<NodeOAuthClient> | null = null;

export function getAtprotoClientMetadata(): OAuthClientOptions["clientMetadata"] {
  const runtime = getAuthRuntimeConfig();
  const clientId = new URL(metadataPath, runtime.publicBaseUrl).toString();
  const redirectUri = new URL(callbackPath, runtime.publicBaseUrl).toString();

  return {
    application_type: "web",
    client_id: clientId,
    client_name: "Atlas",
    client_uri: runtime.publicBaseUrl,
    dpop_bound_access_tokens: true,
    grant_types: ["authorization_code", "refresh_token"],
    redirect_uris: [redirectUri],
    response_types: ["code"],
    scope: "atproto",
    token_endpoint_auth_method: "none",
  };
}

export async function createAtprotoAuthorizationUrl(
  input: AtprotoAuthorizationInput,
): Promise<URL> {
  await pruneAtprotoOAuthStores();
  const session = await requireSignedInAtlasSession();
  const state = randomUUID();
  await appStateStore.set(state, {
    flow: "link",
    requestedHandle: input.handle.trim(),
    returnTo: sanitizeReturnTo(input.returnTo),
    userId: session.user.id,
  });
  const client = await getAtprotoOAuthClient();
  return await client.authorize(input.handle, { state });
}

/**
 * Starts the same ATProto OAuth proof used for linking, but without an Atlas
 * session. Its callback must resolve a pre-existing, passkey-ready controller
 * before Better Auth is allowed to create a browser session.
 */
export async function createAtprotoSignInAuthorizationUrl(
  input: AtprotoAuthorizationInput,
): Promise<URL> {
  await pruneAtprotoOAuthStores();
  const state = randomUUID();
  await appStateStore.set(state, {
    flow: "sign-in",
    requestedHandle: input.handle.trim(),
    returnTo: sanitizeReturnTo(input.returnTo),
  });
  const client = await getAtprotoOAuthClient();
  return await client.authorize(input.handle, { state });
}

/**
 * Provisions an Atlas-hosted account for the signed-in user, then records its
 * public identity through the same API used by external PDS OAuth linking.
 */
export async function provisionAndLinkManagedAtprotoIdentity(input: {
  handle: string;
}): Promise<LinkedAtprotoIdentity> {
  const session = await requireSignedInAtlasSession();
  const managedIdentity = await provisionManagedAtprotoIdentity({
    email: session.user.email,
    handle: input.handle,
    userId: session.user.id,
  });
  return await persistLinkedAtprotoIdentity(managedIdentity);
}

export async function completeAtprotoAuthorization(params: URLSearchParams): Promise<string> {
  await pruneAtprotoOAuthStores();
  const session = await requireSignedInAtlasSession();
  const client = await getAtprotoOAuthClient();
  const result = await client.callback(params);
  try {
    const stateKey = result.state;
    const state = stateKey ? await appStateStore.get(stateKey) : undefined;
    if (!stateKey || state?.userId !== session.user.id) {
      throw new UserFacingError("ATProto verification state could not be matched to this session.");
    }
    await appStateStore.del(stateKey);

    const agent = new Agent(result.session);
    const [profile, tokenInfo] = await Promise.all([
      agent.getProfile({ actor: result.session.did }),
      result.session.getTokenInfo("auto"),
    ]);
    if (profile.data.did !== result.session.did) {
      throw recoverableAtprotoOAuthError(
        "ATProto identity could not be verified.",
        state.returnTo,
        state.requestedHandle,
      );
    }
    if (profile.data.handle.toLowerCase() !== state.requestedHandle.toLowerCase()) {
      throw recoverableAtprotoOAuthError(
        "ATProto identity could not be verified.",
        state.returnTo,
        state.requestedHandle,
      );
    }
    await verifyResolvedAtprotoIdentity(agent, {
      did: result.session.did,
      handle: profile.data.handle,
    }).catch(() => {
      throw recoverableAtprotoOAuthError(
        "ATProto identity could not be verified.",
        state.returnTo,
        state.requestedHandle,
      );
    });
    const identity = await persistLinkedAtprotoIdentity({
      did: result.session.did,
      current_handle: profile.data.handle,
      pds_url: tokenInfo.aud,
    }).catch(() => {
      throw recoverableAtprotoOAuthError(
        "ATProto identity could not be linked.",
        state.returnTo,
        state.requestedHandle,
      );
    });
    return atprotoSuccessRedirect(state.returnTo, identity);
  } finally {
    if (result.state) {
      await appStateStore.del(result.state);
      await stateStore.del(result.state);
    }
    await sessionStore.del(result.session.did);
  }
}

/**
 * Dispatches the shared provider callback according to the state that was
 * written before redirecting to the provider. Both flows use the single
 * registered redirect URI in Atlas's OAuth client metadata.
 */
export async function completeAtprotoOAuthCallback(params: URLSearchParams): Promise<Response> {
  const stateKey = params.get("state") ?? "";
  const state = stateKey ? await appStateStore.get(stateKey) : undefined;
  if (state?.flow === "sign-in") {
    return await completeAtprotoSignIn(params);
  }
  return Response.redirect(await completeAtprotoAuthorization(params), 302);
}

/**
 * Completes an anonymous ATProto OAuth proof and hands a verified active
 * controller to Better Auth's server-only, passkey-gated session endpoint.
 */
export async function completeAtprotoSignIn(params: URLSearchParams): Promise<Response> {
  await pruneAtprotoOAuthStores();
  const client = await getAtprotoOAuthClient();
  const result = await client.callback(params);
  try {
    const stateKey = result.state;
    const state = stateKey ? await appStateStore.get(stateKey) : undefined;
    if (!stateKey || state?.flow !== "sign-in") {
      throw new UserFacingError("ATProto sign-in is unavailable.");
    }
    await appStateStore.del(stateKey);

    const agent = new Agent(result.session);
    const profile = await agent.getProfile({ actor: result.session.did });
    if (
      profile.data.did !== result.session.did ||
      profile.data.handle.toLowerCase() !== state.requestedHandle.toLowerCase()
    ) {
      throw new UserFacingError("ATProto sign-in is unavailable.");
    }
    await verifyResolvedAtprotoIdentity(agent, {
      did: result.session.did,
      handle: profile.data.handle,
    }).catch(() => {
      throw new UserFacingError("ATProto sign-in is unavailable.");
    });

    const userId = await resolveAtprotoSignInController({ did: result.session.did });
    const sessionResponse = await createAtprotoSessionForUser(userId);
    const headers = new Headers(sessionResponse.headers);
    headers.set(
      "Location",
      new URL(state.returnTo, getAuthRuntimeConfig().publicBaseUrl).toString(),
    );
    return new Response(null, { headers, status: 302 });
  } finally {
    if (result.state) {
      await appStateStore.del(result.state);
      await stateStore.del(result.state);
    }
    await sessionStore.del(result.session.did);
  }
}

function recoverableAtprotoOAuthError(
  message: string,
  returnTo: string,
  attemptedHandle: string,
): RecoverableAtprotoOAuthError {
  return Object.assign(new Error(message), { attemptedHandle, returnTo });
}

export async function pruneAtprotoOAuthStores(): Promise<void> {
  await pruneAtprotoOAuthStoreRows({ appStateStore, sessionStore, stateStore });
}

async function getAtprotoOAuthClient(): Promise<NodeOAuthClient> {
  const scoped = requestResource(
    "atproto",
    () =>
      new NodeOAuthClient({
        allowHttp: isLocalHttpUrl(getAuthRuntimeConfig().publicBaseUrl),
        clientMetadata: getAtprotoClientMetadata(),
        responseMode: "query",
        sessionStore,
        stateStore,
      }),
  );
  if (scoped) return scoped;
  if (!clientPromise) {
    clientPromise = Promise.resolve(
      new NodeOAuthClient({
        allowHttp: isLocalHttpUrl(getAuthRuntimeConfig().publicBaseUrl),
        clientMetadata: getAtprotoClientMetadata(),
        responseMode: "query",
        sessionStore,
        stateStore,
      }),
    );
  }
  return await clientPromise;
}

async function requireSignedInAtlasSession() {
  const session = await loadAtlasSession();
  if (!session) {
    throw new UserFacingError("Sign in before verifying an ATProto account.");
  }
  return session;
}

async function verifyResolvedAtprotoIdentity(
  agent: Agent,
  input: ResolvedAtprotoIdentityInput,
): Promise<void> {
  const resolved = await agent.com.atproto.identity.resolveIdentity({
    identifier: input.did,
  });
  const didDoc = resolved.data.didDoc;
  const didDocId = didDoc && typeof didDoc === "object" ? didDoc.id : undefined;
  if (
    resolved.data.did !== input.did ||
    resolved.data.handle.toLowerCase() !== input.handle.toLowerCase() ||
    didDocId !== input.did
  ) {
    throw new UserFacingError("ATProto identity could not be verified.");
  }
}

async function persistLinkedAtprotoIdentity(
  input: LinkedAtprotoIdentityInput,
): Promise<LinkedAtprotoIdentity> {
  const runtime = getAuthRuntimeConfig();
  const session = await requireSignedInAtlasSession();
  const target = runtime.apiBaseUrl ?? runtime.publicBaseUrl;
  const response = await fetchAtlasApiResponse(new URL("/api/atproto/identities", target), {
    body: JSON.stringify(input),
    headers: {
      "Content-Type": "application/json",
      ...(await createAppActorHeaders(session.user, {
        accountReady: session.accountReady,
        organizationId: session.workspace.activeOrganization?.id,
      })),
    },
    method: "POST",
  });
  if (!response.ok) {
    throw new UserFacingError("ATProto identity could not be linked.");
  }
  return (await response.json()) as LinkedAtprotoIdentity;
}

async function resolveAtprotoSignInController(
  input: { did: string } | { handle: string },
): Promise<string> {
  const runtime = getAuthRuntimeConfig();
  const target = runtime.apiBaseUrl ?? runtime.publicBaseUrl;
  const response = await fetchAtlasApiResponse(
    new URL("/api/atproto/identities/sign-in/resolve", target),
    {
      body: JSON.stringify(input),
      headers: {
        "Content-Type": "application/json",
        ...(await createAppActorHeaders(
          { email: "atproto-sign-in@atlas.internal", id: "atproto-sign-in" },
          { accountReady: false },
        )),
      },
      method: "POST",
    },
  );
  if (!response.ok) {
    throw new UserFacingError("ATProto sign-in is unavailable.");
  }
  const payload = (await response.json()) as { user_id?: unknown };
  if (typeof payload.user_id !== "string" || !payload.user_id) {
    throw new UserFacingError("ATProto sign-in is unavailable.");
  }
  return payload.user_id;
}

export function parseAtprotoReturnTo(value: string): AtprotoReturnContext {
  const runtime = getAuthRuntimeConfig();
  const publicOrigin = new URL(runtime.publicBaseUrl).origin;
  const parsed = new URL(value, runtime.publicBaseUrl);
  if (parsed.origin !== publicOrigin) {
    throw new UserFacingError("ATProto return destination is not allowed.");
  }
  if (parsed.pathname === "/account") {
    return { kind: "account" };
  }
  const claim = /^\/claim\/([^/]+)$/.exec(parsed.pathname);
  if (claim?.[1]) {
    return { kind: "claim", slug: decodeURIComponent(claim[1]) };
  }
  const manage = /^\/manage\/([^/]+)$/.exec(parsed.pathname);
  if (manage?.[1]) {
    return { kind: "manage", slug: decodeURIComponent(manage[1]) };
  }
  throw new UserFacingError("ATProto return destination is not allowed.");
}

function sanitizeReturnTo(value: string): string {
  parseAtprotoReturnTo(value);
  const parsed = new URL(value, getAuthRuntimeConfig().publicBaseUrl);
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

function atprotoSuccessRedirect(returnTo: string, identity: LinkedAtprotoIdentity): string {
  const context = parseAtprotoReturnTo(returnTo);
  const redirectUrl = new URL(returnTo, getAuthRuntimeConfig().publicBaseUrl);
  redirectUrl.searchParams.delete("atprotoError");
  redirectUrl.searchParams.delete("atprotoHandle");
  redirectUrl.searchParams.set("atprotoStatus", "connected");
  redirectUrl.searchParams.set("atprotoIdentityId", identity.id);
  if (context.kind === "account") {
    redirectUrl.hash = "identity";
  }
  return redirectUrl.toString();
}

function isLocalHttpUrl(value: string): boolean {
  const url = new URL(value);
  return url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
}
