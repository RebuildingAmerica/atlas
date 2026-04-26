import "@tanstack/react-start/server-only";

import { atlasSessionSchema } from "./session-schema";
import { DEFAULT_CAPABILITIES, DEFAULT_LIMITS } from "../capabilities";
import { canEmailAccessAtlas, ensureAuthReady, hasExistingAccount, type getAuth } from "./auth";
import { loadAtlasWorkspaceState } from "./organization-session";
import { getBrowserSessionHeaders } from "./request-headers";
import { getAuthRuntimeConfig, validateAuthRuntimeConfig } from "./runtime";
import type { AtlasSessionPayload } from "../organization-contracts";

/**
 * Better Auth instance shape used by Atlas's session-state helpers.
 */
type AtlasAuthInstance = ReturnType<typeof getAuth>;

/**
 * Local-mode single-operator session used when auth is disabled entirely.
 */
function getLocalSession(): AtlasSessionPayload {
  return {
    accountReady: true,
    hasPasskey: true,
    isLocal: true,
    passkeyCount: 1,
    session: {
      id: "local-session",
    },
    user: {
      email: "local@atlas.local",
      emailVerified: true,
      id: "local-operator",
      name: "Local Operator",
    },
    workspace: {
      activeOrganization: {
        id: "local-workspace",
        name: "Local Workspace",
        role: "owner",
        slug: "local",
        workspaceType: "individual",
      },
      activeProducts: [],
      capabilities: {
        canInviteMembers: false,
        canManageOrganization: false,
        canSwitchOrganizations: false,
        canUseTeamFeatures: false,
      },
      resolvedCapabilities: {
        capabilities: Array.from(DEFAULT_CAPABILITIES),
        limits: { ...DEFAULT_LIMITS },
      },
      memberships: [
        {
          id: "local-workspace",
          name: "Local Workspace",
          role: "owner",
          slug: "local",
          workspaceType: "individual",
        },
      ],
      onboarding: {
        hasPendingInvitations: false,
        needsWorkspace: false,
      },
      pendingInvitations: [],
    },
  };
}

/**
 * Counts registered passkeys for the current browser session.
 *
 * @param auth - The initialized Better Auth instance for the current server.
 * @param headers - The browser session headers for the current request.
 */
async function getPasskeyCount(auth: AtlasAuthInstance, headers: Headers): Promise<number> {
  const passkeys = await auth.api.listPasskeys({ headers });
  return passkeys.length;
}

/**
 * Returns the current operator session, or `null` when auth is enabled and no
 * session exists.
 */
export async function loadAtlasSession(): Promise<AtlasSessionPayload | null> {
  const runtime = getAuthRuntimeConfig();
  if (runtime.localMode) {
    return getLocalSession();
  }

  const browserSessionHeaders = getBrowserSessionHeaders();
  const auth = await ensureAuthReady();
  const sessionValue = await auth.api.getSession({
    headers: browserSessionHeaders,
  });
  const session = atlasSessionSchema.nullable().parse(sessionValue);

  if (!session) {
    return null;
  }

  const [passkeyCount, workspace] = await Promise.all([
    getPasskeyCount(auth, browserSessionHeaders),
    loadAtlasWorkspaceState(auth, browserSessionHeaders, session),
  ]);
  const hasPasskey = passkeyCount > 0;

  return {
    accountReady: session.user.emailVerified && hasPasskey,
    hasPasskey,
    isLocal: false,
    passkeyCount,
    session: {
      id: session.session.id,
    },
    user: {
      email: session.user.email,
      emailVerified: session.user.emailVerified,
      id: session.user.id,
      name: session.user.name,
    },
    workspace,
  } satisfies AtlasSessionPayload;
}

/**
 * Returns the current operator session or throws when the route is
 * unauthorized.
 */
export async function requireAtlasSessionState(): Promise<AtlasSessionPayload> {
  const session = await loadAtlasSession();
  if (!session) {
    throw new Error("Unauthorized");
  }

  return session;
}

/**
 * Returns the current operator session only when account setup is complete.
 */
export async function requireReadyAtlasSessionState(): Promise<AtlasSessionPayload> {
  const session = await requireAtlasSessionState();
  if (!session.accountReady) {
    throw new Error("Complete account setup before creating Atlas resources.");
  }

  return session;
}

/**
 * Starts the magic-link sign-in flow for an email address.
 *
 * This always keeps allowlist enforcement non-enumerating: disallowed emails
 * still return success so callers cannot probe the operator list.
 *
 * @param data - The sign-in request payload.
 * @param data.callbackURL - The app-local path to return to after sign-in.
 * @param data.email - The email address requesting access.
 * @param data.name - The optional display name Better Auth should remember.
 */
export async function requestMagicLinkForEmail(data: {
  callbackURL?: string;
  email: string;
  name?: string;
}): Promise<{ ok: true }> {
  const runtime = getAuthRuntimeConfig();
  if (runtime.localMode) {
    throw new Error("Auth is disabled in local mode.");
  }

  try {
    validateAuthRuntimeConfig(runtime);
  } catch {
    throw new Error("Sign-in is temporarily unavailable.");
  }

  const emailCanAccessAtlas = await canEmailAccessAtlas(data.email);
  if (!emailCanAccessAtlas) {
    return {
      ok: true,
    };
  }

  const auth = await ensureAuthReady();
  await auth.api.signInMagicLink({
    body: {
      callbackURL: data.callbackURL,
      email: data.email,
      name: data.name,
    },
    headers: getBrowserSessionHeaders(),
  });

  return {
    ok: true,
  };
}

/**
 * Resends the current operator's verification email when their account is not
 * yet ready.
 */
export async function sendVerificationEmailForCurrentSession(): Promise<{ ok: true }> {
  const runtime = getAuthRuntimeConfig();
  if (runtime.localMode) {
    return {
      ok: true,
    };
  }

  const session = await requireAtlasSessionState();
  if (session.user.emailVerified) {
    return {
      ok: true,
    };
  }

  const auth = await ensureAuthReady();
  await auth.api.sendVerificationEmail({
    body: {
      callbackURL: "/account-setup",
      email: session.user.email,
    },
    headers: getBrowserSessionHeaders(),
  });

  return {
    ok: true,
  };
}

/**
 * Checks whether an Atlas account already exists for a given email address.
 *
 * @param email - The email address to look up.
 */
export async function checkEmailAccountExists(email: string): Promise<boolean> {
  return await hasExistingAccount(email);
}
