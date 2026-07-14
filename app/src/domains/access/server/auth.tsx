import "@tanstack/react-start/server-only";

import { apiKey } from "@better-auth/api-key";
import { oauthProvider } from "@better-auth/oauth-provider";
import { passkey } from "@better-auth/passkey";
import { scim } from "@better-auth/scim";
import { createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { betterAuth } from "better-auth";
import { admin, bearer, deviceAuthorization, organization } from "better-auth/plugins";
import { jwt } from "better-auth/plugins/jwt";
import { magicLink } from "better-auth/plugins/magic-link";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { z } from "zod";
import { API_KEY_SCOPES, scopesToPermissions } from "../api-key-scopes";
import { SUPPORTED_OAUTH_SCOPES } from "../oauth-as-metadata";
import { buildAtlasAccessTokenClaims } from "./oauth-claims";
import { resolvePrimaryWorkspaceId } from "./workspace-lookup";
import { queryActiveProducts } from "./workspace-products";
import { type AuthRuntimeConfig, getAuthRuntimeConfig, validateAuthRuntimeConfig } from "./runtime";
import { getAuthDatabaseConfig, getAuthDatabase, getAuthPgPool } from "./auth-db";
import {
  buildAtlasTrustedOrigins,
  enforceRequirePkceOnAllClients,
  SCOUT_DEVICE_LOGIN_EXPIRES_IN,
  SCOUT_DEVICE_LOGIN_INTERVAL,
  isRegisteredOAuthDeviceClient,
} from "./auth-support";
import {
  createMagicLinkSender,
  sendAtlasOrganizationInvitation,
  sendAtlasVerificationEmail,
} from "./auth-callbacks";

export { getAuthDatabase, getAuthDatabaseConfig, getAuthPgPool } from "./auth-db";
export {
  canEmailAccessAtlas,
  createMagicLinkSender,
  createVerificationEmailSender,
  hasExistingAccount,
} from "./auth-callbacks";

/**
 * Return whether Atlas should allow a SCIM token for the workspace.
 *
 * The product contract is intentionally narrow: SCIM is included with Atlas
 * Team, while Research Pass keeps Team-level individual quota without
 * organization-management controls.
 *
 * @param organizationId - Better Auth organization id the SCIM token would manage.
 */
export async function canGenerateScimTokenForWorkspace(
  organizationId: string | undefined,
): Promise<boolean> {
  if (!organizationId) {
    return false;
  }

  const activeProducts = await queryActiveProducts(organizationId);
  return activeProducts.includes("atlas_team");
}

function atprotoSignInSession() {
  return {
    id: "atlas-atproto-sign-in",
    endpoints: {
      completeAtprotoSignIn: createAuthEndpoint(
        "/internal/atproto-sign-in",
        {
          body: z.object({ userId: z.string().min(1) }),
          method: "POST",
        },
        async (ctx) => {
          // This endpoint must only be reached through auth.api from the
          // server-side OAuth callback; HTTP requests can otherwise nominate a
          // user ID and bypass the DID-control proof.
          if (ctx.request) {
            throw ctx.error("FORBIDDEN", { message: "ATProto sign-in is unavailable." });
          }

          const user = await ctx.context.internalAdapter.findUserById(ctx.body.userId);
          const passkeys = await ctx.context.adapter.findMany({
            limit: 1,
            model: "passkey",
            where: [{ field: "userId", value: ctx.body.userId }],
          });
          if (!user?.emailVerified || passkeys.length === 0) {
            throw ctx.error("UNAUTHORIZED", { message: "ATProto sign-in is unavailable." });
          }

          const session = await ctx.context.internalAdapter.createSession(ctx.body.userId);
          if (!session) {
            throw ctx.error("UNAUTHORIZED", { message: "ATProto sign-in is unavailable." });
          }
          await setSessionCookie(ctx, { session, user });
          return ctx.json(null, { status: 204 });
        },
      ),
    },
  };
}

/**
 * Builds the Better Auth runtime for Atlas.
 *
 * Keeping this in one factory makes the concrete auth type available to the
 * rest of the server code without hand-written adapter types.
 *
 * @param runtime - The resolved auth runtime configuration for this process.
 */
async function createAtlasAuth(runtime: AuthRuntimeConfig) {
  const { sso } = await import("@better-auth/sso");
  const configuredAudiences = runtime.authJwtAudiences ?? [];
  const validAudiences =
    configuredAudiences.length > 0
      ? [...configuredAudiences]
      : runtime.authJwtAudience
        ? [runtime.authJwtAudience]
        : [];

  return betterAuth({
    appName: "Atlas",
    basePath: "/api/auth",
    baseURL: runtime.publicBaseUrl,
    database: getAuthDatabaseConfig(),
    // Disables Better Auth's built-in `/token` route used by some
    // magic-link verification flows.  This does NOT touch the OAuth 2.1
    // token endpoint exposed by the oauthProvider plugin at
    // /api/auth/oauth2/token — that endpoint stays live.
    disabledPaths: ["/token"],
    rateLimit: {
      customRules: {
        // OAuth device clients must poll this endpoint until browser approval.
        // The opaque, high-entropy device code preserves the exchange boundary;
        // applying the general request bucket here can otherwise make a normal
        // Scout login fail before the user can finish approving it.
        "/device/token": false,
      },
    },
    secret: runtime.internalSecret,
    trustedOrigins: buildAtlasTrustedOrigins(runtime.publicBaseUrl),
    emailAndPassword: {
      enabled: false,
    },
    emailVerification: {
      sendVerificationEmail: sendAtlasVerificationEmail,
    },
    // OIDC Core 1.0 §5.7: only trust `email_verified` from providers Atlas
    // has explicitly vetted.  Without `disableImplicitLinking`, Better Auth
    // would link any IdP whose token claims `email_verified: true`, allowing
    // a hostile OIDC provider to claim someone else's email and take over
    // their Atlas account.
    account: {
      accountLinking: {
        disableImplicitLinking: true,
        trustedProviders: ["google"],
      },
    },
    plugins: [
      magicLink({
        disableSignUp: false,
        // Five-minute TTL is short enough to bound replay risk on a leaked
        // link and long enough that an operator can paste the URL into a
        // different browser if their mail client opens external links in a
        // surface they don't want.  The sign-up page surfaces the same
        // value via `MAGIC_LINK_EXPIRY_SECONDS`; keep them in sync.
        expiresIn: 300,
        sendMagicLink: createMagicLinkSender(),
      }),
      passkey({
        rpID: runtime.passkeyRpId ?? runtime.publicDomain,
        rpName: "Atlas",
      }),
      organization({
        allowUserToCreateOrganization: true,
        membershipLimit: 50,
        requireEmailVerificationOnInvitation: true,
        sendInvitationEmail: sendAtlasOrganizationInvitation,
        teams: {
          enabled: false,
        },
      }),
      admin(),
      scim({
        canGenerateToken: ({ organizationId }) => canGenerateScimTokenForWorkspace(organizationId),
        linkExistingUsers: {
          requireExistingOrgMembership: true,
        },
        requiredRole: ["admin", "owner"],
        storeSCIMToken: "hashed",
      }),
      sso({
        disableImplicitSignUp: true,
        domainVerification: {
          enabled: true,
        },
        organizationProvisioning: {
          defaultRole: "member",
          disabled: false,
        },
        redirectURI: "/sso/callback",
        saml: {
          algorithms: {
            onDeprecated: "reject",
          },
          clockSkew: 60 * 1000,
          requireTimestamps: true,
          // OIDC Session Management 1.0: terminate the IdP session when the
          // user signs out of Atlas so the federated session does not linger
          // after a workspace member quits or rotates devices.
          enableSingleLogout: true,
        },
      }),
      jwt({
        jwt: {
          // Setting the issuer to the auth basePath ensures the OIDC discovery
          // endpoint at {issuer}/.well-known/openid-configuration maps to
          // /api/auth/.well-known/openid-configuration, which the existing
          // api/auth/$.ts catch-all serves automatically.
          issuer: new URL("/api/auth", runtime.publicBaseUrl).toString().replace(/\/$/, ""),
          audience: runtime.authJwtAudience ?? undefined,
          definePayload: async ({ user }) => {
            const orgId = await resolvePrimaryWorkspaceId(user.id);
            return {
              email: user.email,
              permissions: scopesToPermissions([...API_KEY_SCOPES]),
              ...(orgId ? { org_id: orgId } : {}),
              ...(runtime.authJwtAudience ? { aud: runtime.authJwtAudience } : {}),
            };
          },
        },
      }),
      bearer(),
      deviceAuthorization({
        expiresIn: SCOUT_DEVICE_LOGIN_EXPIRES_IN,
        interval: SCOUT_DEVICE_LOGIN_INTERVAL,
        validateClient: isRegisteredOAuthDeviceClient,
        verificationUri: "/device",
      }),
      oauthProvider({
        loginPage: "/sign-in",
        consentPage: "/oauth/consent",
        // RFC 7591 §3: dynamic client registration is gated to authenticated
        // sessions so anonymous attackers cannot register clients with hostile
        // redirect_uris and phish authenticated Atlas users via /authorize.
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: false,
        // RFC 9700 §4.13 favors short-lived access tokens.  15 minutes keeps
        // the token-leak blast radius small while still amortising one
        // refresh roundtrip per quarter-hour for active clients.
        accessTokenExpiresIn: 15 * 60,
        ...(validAudiences.length > 0 ? { validAudiences } : {}),
        // OAuth AS metadata is served by the TanStack routes under
        // `app/src/routes/[.]well-known/oauth-authorization-server/`, which
        // satisfies both the conventional root path and the strict RFC 8414
        // §3 issuer-suffix path.  MCP clients also have OIDC discovery
        // available via the api/auth catch-all as a fallback.
        silenceWarnings: {
          oauthAuthServerConfig: true,
        },
        scopes: [...SUPPORTED_OAUTH_SCOPES],
        customAccessTokenClaims: (params) =>
          buildAtlasAccessTokenClaims(params, {
            defaultAudience: runtime.authJwtAudience,
            resolveActiveProductsForWorkspace: queryActiveProducts,
            resolvePrimaryWorkspaceId,
          }),
      }),
      apiKey({
        defaultKeyLength: 40,
        enableSessionForAPIKeys: false,
        // Atlas manages API-key scope explicitly; an implicit 10-request
        // Better Auth default would make brand-new keys look broken at launch.
        rateLimit: {
          enabled: false,
        },
      }),
      atprotoSignInSession(),
      tanstackStartCookies(),
    ],
  });
}

/**
 * Concrete Better Auth instance Atlas uses after plugin registration.
 */
type AtlasAuthInstance = Awaited<ReturnType<typeof createAtlasAuth>>;

/**
 * Better Auth context resolved before Atlas runs schema migrations.
 */
export type AtlasAuthContext = Awaited<AtlasAuthInstance["$context"]>;

/**
 * Adapter surfaces exposed for modules that work with Better Auth storage
 * directly instead of the full request handler.
 */
export type AtlasAuthAdapter = AtlasAuthContext["adapter"];
export type AtlasAuthInternalAdapter = AtlasAuthContext["internalAdapter"];

type AtlasAuthApi = AtlasAuthInstance["api"];

type AtlasPasskeyApi = Pick<AtlasAuthApi, "listPasskeys">;

type AtlasWorkspaceApi = Pick<
  AtlasAuthApi,
  "createOrganization" | "getActiveMemberRole" | "listOrganizations" | "listUserInvitations"
>;

/**
 * Minimal Better Auth surface Atlas needs to read passkey state.
 */
export interface AtlasPasskeyAuth {
  api: AtlasPasskeyApi;
}

/**
 * Minimal Better Auth surface Atlas needs to build workspace session state.
 */
export interface AtlasWorkspaceStateAuth {
  api: AtlasWorkspaceApi;
}

let authInstance: AtlasAuthInstance | null = null;
let authInstancePromise: Promise<AtlasAuthInstance> | null = null;
let authReadyPromise: Promise<AtlasAuthInstance> | null = null;

/**
 * Returns the singleton Better Auth instance for the current app server
 * process.
 */
export async function getAuth() {
  if (authInstance) {
    return authInstance;
  }

  if (!authInstancePromise) {
    const runtime = getAuthRuntimeConfig();
    validateAuthRuntimeConfig(runtime);
    authInstancePromise = createAtlasAuth(runtime).then((auth) => {
      authInstance = auth;
      return auth;
    });
  }

  return await authInstancePromise;
}

/**
 * Runs Better Auth database migrations and returns the ready auth instance.
 *
 * @param context - The resolved Better Auth runtime context.
 */
async function runAtlasAuthMigrations(context: AtlasAuthContext): Promise<AtlasAuthInstance> {
  await context.runMigrations();

  const { ATLAS_MIGRATIONS, runAtlasCustomMigrations, runAtlasCustomMigrationsPg } =
    await import("./atlas-migrations");
  const pool = getAuthPgPool();
  if (pool) {
    await runAtlasCustomMigrationsPg(pool, ATLAS_MIGRATIONS);
  } else {
    const db = getAuthDatabase();
    /* v8 ignore start -- in sqlite mode (no pool) getAuthDatabase always returns a non-null instance */
    if (!db) {
      throw new Error("Auth database unavailable for migrations in current mode");
    }
    /* v8 ignore stop */
    runAtlasCustomMigrations(db, ATLAS_MIGRATIONS);
  }

  await enforceRequirePkceOnAllClients(getAuthDatabase(), getAuthPgPool());

  const auth = await getAuth();
  return auth;
}

/**
 * Ensures Better Auth has finished its schema migrations before use.
 *
 * This is the guard that keeps magic links, passkeys, sessions, and API keys
 * from failing on a fresh auth database.
 */
export async function ensureAuthReady() {
  const auth = await getAuth();
  if (!authReadyPromise) {
    authReadyPromise = auth.$context.then(runAtlasAuthMigrations);
  }

  const readyAuth = await authReadyPromise;
  return readyAuth;
}
