import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import { Agent } from "@atproto/api";
import { NodeOAuthClient, type OAuthClientOptions } from "@atproto/oauth-client-node";
import { createInternalAuthHeaders } from "@/domains/access/config";
import {
  createAtprotoOAuthStores,
  pruneAtprotoOAuthStores as pruneAtprotoOAuthStoreRows,
} from "./atproto-oauth-stores";
import { provisionManagedAtprotoIdentity } from "./atproto-pds";
import { loadAtlasSession } from "./session-state";
import { getAuthRuntimeConfig } from "./runtime";

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
const harnessAuthorizePath = "/api/atproto/oauth/harness/authorize";
const e2eHarnessCode = "atlas-e2e-harness";

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
    requestedHandle: input.handle.trim(),
    returnTo: sanitizeReturnTo(input.returnTo),
    userId: session.user.id,
  });
  if (isE2EHarnessEnabled()) {
    return e2eHarnessAuthorizeUrl(input.handle.trim(), state);
  }
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
    handle: input.handle,
    userId: session.user.id,
  });
  return await persistLinkedAtprotoIdentity(managedIdentity);
}

export function createAtprotoHarnessProviderCallbackUrl(params: URLSearchParams): URL {
  const state = params.get("state")?.trim();
  const handle = params.get("handle")?.trim();
  if (!state || !handle) {
    throw new Error("ATProto provider harness needs state and handle.");
  }
  return e2eHarnessCallbackUrl(handle, state);
}

export async function completeAtprotoAuthorization(params: URLSearchParams): Promise<string> {
  await pruneAtprotoOAuthStores();
  const session = await requireSignedInAtlasSession();
  if (isE2EHarnessEnabled() && params.get("code") === e2eHarnessCode) {
    return await completeE2EHarnessAuthorization(params, session.user.id);
  }
  const client = await getAtprotoOAuthClient();
  const result = await client.callback(params);
  try {
    const state = result.state ? await appStateStore.get(result.state) : undefined;
    if (state?.userId !== session.user.id) {
      throw new Error("ATProto verification state could not be matched to this session.");
    }
    await appStateStore.del(result.state ?? "");

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

async function completeE2EHarnessAuthorization(
  params: URLSearchParams,
  userId: string,
): Promise<string> {
  const stateKey = params.get("state") ?? "";
  const handle = params.get("handle")?.trim() ?? "";
  const state = stateKey ? await appStateStore.get(stateKey) : undefined;
  if (state?.userId !== userId || !handle) {
    throw new Error("ATProto verification state could not be matched to this session.");
  }
  if (state.requestedHandle.toLowerCase() !== handle.toLowerCase()) {
    throw recoverableAtprotoOAuthError(
      "ATProto identity could not be verified.",
      state.returnTo,
      state.requestedHandle,
    );
  }
  await appStateStore.del(stateKey);
  const identity = await persistLinkedAtprotoIdentity({
    current_handle: handle,
    did: e2eHarnessDid(handle),
    pds_url: "https://pds.atlas-e2e.test",
  });
  return atprotoSuccessRedirect(state.returnTo, identity);
}

function e2eHarnessCallbackUrl(handle: string, state: string): URL {
  const callbackUrl = new URL(callbackPath, getAuthRuntimeConfig().publicBaseUrl);
  callbackUrl.searchParams.set("code", e2eHarnessCode);
  callbackUrl.searchParams.set("state", state);
  callbackUrl.searchParams.set("handle", handle);
  return callbackUrl;
}

function e2eHarnessAuthorizeUrl(handle: string, state: string): URL {
  const authorizeUrl = new URL(harnessAuthorizePath, getAuthRuntimeConfig().publicBaseUrl);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("handle", handle);
  return authorizeUrl;
}

function e2eHarnessDid(handle: string): string {
  return `did:web:${handle.toLowerCase().replace(/^@/, "")}`;
}

function recoverableAtprotoOAuthError(
  message: string,
  returnTo: string,
  attemptedHandle: string,
): RecoverableAtprotoOAuthError {
  return Object.assign(new Error(message), { attemptedHandle, returnTo });
}

function isE2EHarnessEnabled(): boolean {
  return process.env.ATLAS_ATPROTO_OAUTH_E2E_HARNESS === "1";
}

export async function pruneAtprotoOAuthStores(): Promise<void> {
  await pruneAtprotoOAuthStoreRows({ appStateStore, sessionStore, stateStore });
}

async function getAtprotoOAuthClient(): Promise<NodeOAuthClient> {
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
    throw new Error("Sign in before verifying an ATProto account.");
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
    throw new Error("ATProto identity could not be verified.");
  }
}

async function persistLinkedAtprotoIdentity(
  input: LinkedAtprotoIdentityInput,
): Promise<LinkedAtprotoIdentity> {
  const runtime = getAuthRuntimeConfig();
  const session = await requireSignedInAtlasSession();
  const target = runtime.apiBaseUrl ?? runtime.publicBaseUrl;
  const response = await fetch(new URL("/api/atproto/identities", target), {
    body: JSON.stringify(input),
    headers: {
      "Content-Type": "application/json",
      ...createInternalAuthHeaders(session.user, runtime.internalSecret, {
        organizationId: session.workspace.activeOrganization?.id,
      }),
    },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error("ATProto identity could not be linked.");
  }
  return (await response.json()) as LinkedAtprotoIdentity;
}

export function parseAtprotoReturnTo(value: string): AtprotoReturnContext {
  const runtime = getAuthRuntimeConfig();
  const publicOrigin = new URL(runtime.publicBaseUrl).origin;
  const parsed = new URL(value, runtime.publicBaseUrl);
  if (parsed.origin !== publicOrigin) {
    throw new Error("ATProto return destination is not allowed.");
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
  throw new Error("ATProto return destination is not allowed.");
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
