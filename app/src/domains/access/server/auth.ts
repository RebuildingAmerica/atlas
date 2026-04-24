import "@tanstack/react-start/server-only";

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { Pool } from "pg";
import { sso } from "@better-auth/sso";
import { betterAuth } from "better-auth";
import { jwt } from "better-auth/plugins/jwt";
import { magicLink } from "better-auth/plugins/magic-link";
import { organization } from "better-auth/plugins";
import { oauthProvider } from "@better-auth/oauth-provider";
import { API_KEY_SCOPES, scopesToPermissions, type ApiKeyScope } from "../api-key-scopes";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { apiKey } from "@better-auth/api-key";
import { passkey } from "@better-auth/passkey";
import { GOOGLE_WORKSPACE_ISSUER } from "../organization-sso";
import {
  type AuthRuntimeConfig,
  getAuthRuntimeConfig,
  isAllowedEmail,
  validateAuthRuntimeConfig,
} from "./runtime";
import { createEmailService } from "@/platform/email/server/service";

/**
 * Result row returned when Atlas checks whether an email already belongs to at
 * least one Better Auth organization membership.
 */
interface StoredMembershipCountRow {
  membershipCount: number;
}

/**
 * Result row returned when Atlas checks whether an account exists for a given
 * email address.
 */
interface StoredUserCountRow {
  userCount: number;
}

/**
 * Normalizes an email address before Atlas checks access or sends mail.
 *
 * @param email - The raw email address supplied by the current auth flow.
 */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Prefix used by OAuth clients to request organization context in access
 * tokens.  A client requests scope `org:{org_id}` during authorization; the
 * claims builder validates membership and includes the org_id in the token.
 */
const ORG_SCOPE_PREFIX = "org:";

/**
 * Narrows OAuth scopes down to the Atlas resource scopes we expose through API
 * keys and OAuth access tokens.
 *
 * @param scopes - The raw OAuth scopes Better Auth is about to encode.
 */
function collectAtlasResourceScopes(scopes: string[]): ApiKeyScope[] {
  const resourceScopes: ApiKeyScope[] = [];

  for (const scope of scopes) {
    const isAtlasScope = (API_KEY_SCOPES as readonly string[]).includes(scope);
    if (isAtlasScope) {
      resourceScopes.push(scope as ApiKeyScope);
    }
  }

  return resourceScopes;
}

/**
 * Extracts the organization ID from an `org:{id}` scope, if present.
 *
 * @param scopes - The full list of granted OAuth scopes.
 */
function extractOrgIdFromScopes(scopes: string[]): string | null {
  for (const scope of scopes) {
    if (scope.startsWith(ORG_SCOPE_PREFIX) && scope.length > ORG_SCOPE_PREFIX.length) {
      return scope.slice(ORG_SCOPE_PREFIX.length);
    }
  }
  return null;
}

/**
 * Parameters provided by Better Auth's oauthProvider plugin to the
 * customAccessTokenClaims callback.
 */
interface OAuthAccessTokenClaimsParams {
  metadata?: Record<string, unknown>;
  referenceId?: string;
  resource?: string;
  scopes: string[];
  user?: (Record<string, unknown> & { id: string }) | null;
}

/**
 * Builds Atlas-specific OAuth access-token claims from Better Auth's scope
 * payload.
 *
 * When an OAuth client requests the `org:{org_id}` scope during authorization,
 * the resolved org_id is included in the access token so the API backend can
 * enforce organization context without a separate lookup.
 *
 * @param params - Better Auth's custom-claim payload.
 * @param params.scopes - The OAuth scopes granted to the current client.
 * @param params.user - The user associated with the token, if any.
 * @param params.metadata - The OAuth client metadata, if any.
 */
function buildAtlasAccessTokenClaims(params: OAuthAccessTokenClaimsParams) {
  const { scopes } = params;
  const resourceScopes = collectAtlasResourceScopes(scopes);
  const orgId = extractOrgIdFromScopes(scopes);

  const claims: Record<string, unknown> = {
    permissions: scopesToPermissions(resourceScopes),
  };

  if (orgId) {
    claims.org_id = orgId;
  }

  return claims;
}

/**
 * Builds the trusted-origin allowlist Better Auth uses for enterprise SSO
 * discovery and callback validation.
 *
 * Google Workspace OIDC discovery touches more than one host, so Atlas keeps
 * the full set of Google origins explicit instead of relying on wildcard
 * behavior.
 *
 * @param publicBaseUrl - The public Atlas origin.
 */
function buildAtlasTrustedOrigins(publicBaseUrl: string): string[] {
  const trustedOrigins = [
    publicBaseUrl,
    GOOGLE_WORKSPACE_ISSUER,
    "https://oauth2.googleapis.com",
    "https://openidconnect.googleapis.com",
    "https://www.googleapis.com",
  ];

  return trustedOrigins;
}

/**
 * Builds the Better Auth runtime for Atlas.
 *
 * Keeping this in one factory makes the concrete auth type available to the
 * rest of the server code without hand-written adapter types.
 *
 * @param runtime - The resolved auth runtime configuration for this process.
 */
function createAtlasAuth(runtime: AuthRuntimeConfig) {
  return betterAuth({
    appName: "Atlas",
    basePath: "/api/auth",
    baseURL: runtime.publicBaseUrl,
    database: getAuthDatabaseConfig(),
    disabledPaths: ["/token"],
    secret: runtime.internalSecret,
    trustedOrigins: buildAtlasTrustedOrigins(runtime.publicBaseUrl),
    emailAndPassword: {
      enabled: false,
    },
    emailVerification: {
      sendVerificationEmail: sendAtlasVerificationEmail,
    },
    plugins: [
      magicLink({
        disableSignUp: false,
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
        },
      }),
      jwt({
        jwt: {
          // Setting the issuer to the auth basePath ensures the OIDC discovery
          // endpoint at {issuer}/.well-known/openid-configuration maps to
          // /api/auth/.well-known/openid-configuration, which the existing
          // api/auth/$.ts catch-all serves automatically.
          issuer: `${runtime.publicBaseUrl}/api/auth`,
        },
      }),
      oauthProvider({
        loginPage: "/sign-in",
        consentPage: "/oauth/consent",
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        ...(runtime.apiAudience ? { validAudiences: [runtime.apiAudience] } : {}),
        // OAuth AS metadata at /.well-known/oauth-authorization-server/api/auth
        // requires a root-level handler that doesn't exist (TanStack Router can't
        // create dot-prefix directories). MCP clients fall back to OIDC discovery
        // which works via the catch-all, so we silence only this warning.
        silenceWarnings: { oauthAuthServerConfig: true },
        scopes: [
          "openid",
          "profile",
          "email",
          "offline_access",
          "discovery:read",
          "discovery:write",
          "entities:write",
        ],
        customAccessTokenClaims: buildAtlasAccessTokenClaims,
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
      tanstackStartCookies(),
    ],
  });
}

/**
 * Concrete Better Auth instance Atlas uses after plugin registration.
 */
type AtlasAuthInstance = ReturnType<typeof createAtlasAuth>;

/**
 * Better Auth context resolved before Atlas runs schema migrations.
 */
type AtlasAuthContext = Awaited<AtlasAuthInstance["$context"]>;

let authInstance: AtlasAuthInstance | null = null;
let database: Database.Database | null = null;
let pgPool: Pool | null = null;
let authReadyPromise: Promise<AtlasAuthInstance> | null = null;

/**
 * Returns true when the auth runtime is configured to use PostgreSQL.
 */
function isPostgresMode(): boolean {
  const runtime = getAuthRuntimeConfig();
  return runtime.databaseUrl?.startsWith("postgres") ?? false;
}

/**
 * Opens the persistent SQLite database Better Auth uses for its own state.
 */
function ensureAuthDatabase() {
  const runtime = getAuthRuntimeConfig();
  if (database) {
    return database;
  }

  fs.mkdirSync(path.dirname(runtime.dbPath), { recursive: true });
  database = new Database(runtime.dbPath);
  database.pragma("journal_mode = WAL");
  return database;
}

/**
 * Returns the database configuration for Better Auth.
 *
 * When DATABASE_URL is set to a PostgreSQL URL, Better Auth uses pg directly.
 * Otherwise falls back to the local SQLite database.
 */
function getAuthDatabaseConfig(): Database.Database | { type: "postgres"; url: string } {
  const runtime = getAuthRuntimeConfig();
  if (runtime.databaseUrl?.startsWith("postgres")) {
    return { type: "postgres", url: runtime.databaseUrl };
  }
  return ensureAuthDatabase();
}

/**
 * Returns a Pool for direct queries in PostgreSQL mode.
 */
export function getAuthPgPool(): Pool | null {
  if (!isPostgresMode()) {
    return null;
  }
  if (pgPool) {
    return pgPool;
  }
  const runtime = getAuthRuntimeConfig();
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- guarded by isPostgresMode() above
  pgPool = new Pool({ connectionString: runtime.databaseUrl! });
  return pgPool;
}

/**
 * Returns the SQLite database Better Auth uses for its internal tables.
 * Returns null in PostgreSQL mode — use getAuthPgPool() instead.
 */
export function getAuthDatabase(): Database.Database | null {
  if (isPostgresMode()) {
    return null;
  }
  return ensureAuthDatabase();
}

/**
 * Sends the actual magic-link email through the configured Atlas email service.
 *
 * @param email - The recipient email address.
 * @param url - The Better Auth sign-in URL to deliver.
 */
async function sendMagicLinkEmail(email: string, url: string): Promise<void> {
  const runtime = getAuthRuntimeConfig();
  const emailService = createEmailService(runtime);
  await emailService.send({
    subject: "Sign in to Atlas",
    text: `Use this link to sign in to Atlas: ${url}`,
    to: email,
  });
}

/**
 * Sends the verification email Better Auth generates for Atlas.
 *
 * @param email - The recipient email address.
 * @param url - The Better Auth verification URL to deliver.
 */
async function sendVerificationEmailMessage(email: string, url: string): Promise<void> {
  const runtime = getAuthRuntimeConfig();
  const emailService = createEmailService(runtime);
  await emailService.send({
    subject: "Verify your Atlas email",
    text: `Verify your email for Atlas: ${url}`,
    to: email,
  });
}

/**
 * Sends an organization invitation email through Atlas's configured mail
 * transport.
 *
 * @param email - The invited email address.
 * @param invitationId - The Better Auth invitation id.
 * @param organizationName - The workspace name shown in the invitation copy.
 */
async function sendOrganizationInvitationEmailMessage(
  email: string,
  invitationId: string,
  organizationName: string,
): Promise<void> {
  const runtime = getAuthRuntimeConfig();
  const signInUrl = new URL("/sign-in", runtime.publicBaseUrl);
  signInUrl.searchParams.set("redirect", "/organization");
  signInUrl.searchParams.set("invitation", invitationId);

  const emailService = createEmailService(runtime);
  await emailService.send({
    subject: `Join ${organizationName} on Atlas`,
    text: `You've been invited to join ${organizationName} on Atlas. Sign in to review the invitation: ${signInUrl.toString()}`,
    to: email,
  });
}

/**
 * Better Auth callback that forwards Atlas verification emails through the app
 * mail service.
 *
 * @param params - Better Auth's verification email payload.
 * @param params.user - The user who needs to verify their email.
 * @param params.url - The Better Auth verification URL.
 */
async function sendAtlasVerificationEmail(params: {
  user: { email: string };
  url: string;
}): Promise<void> {
  const { user, url } = params;
  await sendVerificationEmailMessage(user.email, url);
}

/**
 * Better Auth callback that sends Atlas workspace invitations through the app
 * mail service.
 *
 * @param params - Better Auth's organization invitation payload.
 * @param params.email - The invited email address.
 * @param params.id - The Better Auth invitation id.
 * @param params.organization - The invited organization.
 * @param params.organization.name - The organization name shown in the email.
 */
async function sendAtlasOrganizationInvitation(params: {
  email: string;
  id: string;
  organization: { name: string };
}): Promise<void> {
  const { email, id, organization } = params;
  await sendOrganizationInvitationEmailMessage(email, id, organization.name);
}

/**
 * Checks whether an email already has a pending Better Auth organization
 * invitation.
 *
 * @param email - The normalized email address to look up.
 */
async function hasPendingOrganizationInvitation(email: string): Promise<boolean> {
  const auth = await ensureAuthReady();
  const invitations = await auth.api.listUserInvitations({
    query: {
      email,
    },
  });

  for (const invitation of invitations) {
    if (invitation.status === "pending") {
      return true;
    }
  }

  return false;
}

/**
 * Checks whether an email already belongs to at least one Better Auth
 * organization membership.
 *
 * @param email - The normalized email address to look up.
 */
async function hasExistingOrganizationMembership(email: string): Promise<boolean> {
  const pool = getAuthPgPool();
  if (pool) {
    const result = await pool.query(
      'select count(member.id) as "membershipCount" from "user" inner join member on member."userId" = "user".id where lower("user".email) = $1',
      [email],
    );
    return ((result.rows[0] as StoredMembershipCountRow | undefined)?.membershipCount ?? 0) > 0;
  }

  const database = getAuthDatabase();
  if (!database) {
    throw new Error("Auth database unavailable in current mode");
  }
  const statement = database.prepare(
    [
      "select count(member.id) as membershipCount",
      "from user",
      "inner join member on member.userId = user.id",
      "where lower(user.email) = ?",
    ].join(" "),
  );
  const membershipCountRow = statement.get(email) as StoredMembershipCountRow | undefined;

  return (membershipCountRow?.membershipCount ?? 0) > 0;
}

/**
 * Checks whether an Atlas account already exists for a given email address.
 *
 * @param email - The raw email address to look up.
 */
export async function hasExistingAccount(email: string): Promise<boolean> {
  const normalizedEmail = normalizeEmail(email);
  const pool = getAuthPgPool();

  if (pool) {
    const result = await pool.query(
      'select count(id) as "userCount" from "user" where lower(email) = $1',
      [normalizedEmail],
    );
    return ((result.rows[0] as StoredUserCountRow | undefined)?.userCount ?? 0) > 0;
  }

  const database = getAuthDatabase();
  if (!database) {
    throw new Error("Auth database unavailable in current mode");
  }

  const statement = database.prepare(
    "select count(id) as userCount from user where lower(email) = ?",
  );
  const row = statement.get(normalizedEmail) as StoredUserCountRow | undefined;
  return (row?.userCount ?? 0) > 0;
}

/**
 * Resolves whether an email may start an Atlas sign-in flow.
 *
 * Atlas grants access when the email is on the bootstrap allowlist, already
 * belongs to a workspace, or has a pending organization invitation.
 *
 * @param email - The raw email address attempting to sign in.
 */
export async function canEmailAccessAtlas(email: string): Promise<boolean> {
  const normalizedEmail = normalizeEmail(email);
  const runtime = getAuthRuntimeConfig();

  if (runtime.openRegistration) {
    return true;
  }

  if (isAllowedEmail(normalizedEmail)) {
    return true;
  }

  if (runtime.localMode) {
    return false;
  }

  if (await hasExistingOrganizationMembership(normalizedEmail)) {
    return true;
  }

  try {
    const hasPendingInvitation = await hasPendingOrganizationInvitation(normalizedEmail);
    return hasPendingInvitation;
  } catch {
    return false;
  }
}

/**
 * Returns the Better Auth magic-link sender used by Atlas.
 *
 * The important behavior here is privacy: unapproved emails are ignored
 * silently so the direct auth route does not reveal the operator allowlist.
 *
 * @param deliverMagicLink - The concrete email delivery function to use.
 */
export function createMagicLinkSender(
  deliverMagicLink: (email: string, url: string) => Promise<void> = sendMagicLinkEmail,
) {
  /**
   * Delivers a magic-link email only when the address can legitimately access
   * Atlas.
   *
   * @param params - The Better Auth magic-link payload.
   * @param params.email - The recipient email address.
   * @param params.url - The Better Auth sign-in URL.
   */
  return async function atlasMagicLinkSender(params: {
    email: string;
    url: string;
  }): Promise<void> {
    const { email, url } = params;
    // Keep allowlist enforcement private even on the direct Better Auth route.
    const emailCanAccessAtlas = await canEmailAccessAtlas(email);
    if (!emailCanAccessAtlas) {
      return;
    }

    await deliverMagicLink(email, url);
  };
}

/**
 * Wraps Atlas verification email delivery in the callback shape Better Auth
 * expects.
 *
 * @param deliverVerificationEmail - The concrete verification email sender.
 */
export function createVerificationEmailSender(
  deliverVerificationEmail: (
    email: string,
    url: string,
  ) => Promise<void> = sendVerificationEmailMessage,
) {
  /**
   * Delivers a verification email through Atlas's configured email service.
   *
   * @param params - The Better Auth verification email payload.
   * @param params.email - The recipient email address.
   * @param params.url - The Better Auth verification URL.
   */
  return async function atlasVerificationEmailSender(params: {
    email: string;
    url: string;
  }): Promise<void> {
    const { email, url } = params;
    await deliverVerificationEmail(email, url);
  };
}

/**
 * Returns the singleton Better Auth instance for the current app server
 * process.
 */
export function getAuth() {
  if (authInstance) {
    return authInstance;
  }

  const runtime = getAuthRuntimeConfig();
  validateAuthRuntimeConfig(runtime);
  authInstance = createAtlasAuth(runtime);

  return authInstance;
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
    if (db) {
      runAtlasCustomMigrations(db, ATLAS_MIGRATIONS);
    }
  }

  const auth = getAuth();
  return auth;
}

/**
 * Ensures Better Auth has finished its schema migrations before use.
 *
 * This is the guard that keeps magic links, passkeys, sessions, and API keys
 * from failing on a fresh auth database.
 */
export async function ensureAuthReady() {
  const auth = getAuth();
  if (!authReadyPromise) {
    authReadyPromise = auth.$context.then(runAtlasAuthMigrations);
  }

  const readyAuth = await authReadyPromise;
  return readyAuth;
}
