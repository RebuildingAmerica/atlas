import "@tanstack/react-start/server-only";

import { getAuthDatabase, getAuthPgPool } from "./auth";
import { getAuthRuntimeConfig } from "./runtime";
import { loadAtlasSession } from "./session-state";

interface LinkedOidcAccountRow {
  idToken: string;
  providerId: string;
  issuer: string;
}

interface DiscoveryCacheEntry {
  endSessionEndpoint: string | null;
  expiresAt: number;
}

/**
 * Process-local cache of OIDC discovery documents, keyed by issuer URL.  The
 * end_session_endpoint is the only field we read, so we store just that and
 * the cache expiry to keep the entry minimal.
 */
const _discoveryCache = new Map<string, DiscoveryCacheEntry>();

const DISCOVERY_CACHE_TTL_MS = 10 * 60 * 1000;
const DISCOVERY_FETCH_TIMEOUT_MS = 3000;

/**
 * Returns the user's most recent linked SSO account that holds an `idToken`,
 * joined to the SSO provider's issuer URL.
 *
 * @param userId - The Better Auth user identifier for the active session.
 */
async function loadMostRecentLinkedOidcAccount(
  userId: string,
): Promise<LinkedOidcAccountRow | null> {
  const pool = getAuthPgPool();
  if (pool) {
    const result = await pool.query<LinkedOidcAccountRow>(
      `select account."idToken" as "idToken",
              account."providerId" as "providerId",
              "ssoProvider".issuer as issuer
         from account
         join "ssoProvider" on "ssoProvider"."providerId" = account."providerId"
        where account."userId" = $1
          and account."idToken" is not null
        order by account."updatedAt" desc nulls last,
                 account."createdAt" desc nulls last
        limit 1`,
      [userId],
    );
    return result.rows[0] ?? null;
  }

  const database = getAuthDatabase();
  if (!database) {
    return null;
  }

  const statement = database.prepare(
    `select account.idToken as idToken,
            account.providerId as providerId,
            ssoProvider.issuer as issuer
       from account
       join ssoProvider on ssoProvider.providerId = account.providerId
      where account.userId = ?
        and account.idToken is not null
      order by account.updatedAt desc, account.createdAt desc
      limit 1`,
  );
  const row = statement.get(userId) as LinkedOidcAccountRow | undefined;
  return row ?? null;
}

/**
 * Looks up the OIDC `end_session_endpoint` for an issuer, caching the result
 * for ten minutes so a single sign-out does not re-fetch discovery on every
 * navigation.  Network failures and missing endpoints are remembered as
 * `null` so a flaky IdP cannot turn each sign-out into a multi-second wait.
 *
 * @param issuer - The OIDC issuer URL extracted from the linked account.
 */
async function fetchEndSessionEndpoint(issuer: string): Promise<string | null> {
  const cached = _discoveryCache.get(issuer);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.endSessionEndpoint;
  }

  let endSessionEndpoint: string | null = null;
  try {
    const response = await fetch(`${issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`, {
      signal: AbortSignal.timeout(DISCOVERY_FETCH_TIMEOUT_MS),
    });
    if (response.ok) {
      const document = (await response.json()) as { end_session_endpoint?: unknown };
      if (typeof document.end_session_endpoint === "string") {
        endSessionEndpoint = document.end_session_endpoint;
      }
    }
  } catch {
    endSessionEndpoint = null;
  }

  _discoveryCache.set(issuer, {
    endSessionEndpoint,
    expiresAt: Date.now() + DISCOVERY_CACHE_TTL_MS,
  });
  return endSessionEndpoint;
}

/**
 * Returns the OIDC RP-Initiated Logout 1.0 redirect URL for the active
 * Atlas session, or `null` when there is no linked OIDC account or the IdP
 * does not advertise an `end_session_endpoint`.
 *
 * Sign-out call sites invoke this BEFORE clearing the local session — the
 * id_token_hint is sourced from the still-valid linked account row — and
 * navigate to the returned URL after `signOut()` completes so the IdP
 * terminates the federated session as well.
 */
export async function loadOidcRpLogoutRedirect(): Promise<string | null> {
  const session = await loadAtlasSession();
  if (!session) {
    return null;
  }

  const account = await loadMostRecentLinkedOidcAccount(session.user.id);
  if (!account?.idToken) {
    return null;
  }

  const endSessionEndpoint = await fetchEndSessionEndpoint(account.issuer);
  if (!endSessionEndpoint) {
    return null;
  }

  const runtime = getAuthRuntimeConfig();
  const url = new URL(endSessionEndpoint);
  url.searchParams.set("id_token_hint", account.idToken);
  url.searchParams.set("post_logout_redirect_uri", `${runtime.publicBaseUrl}/post-logout`);
  return url.toString();
}
