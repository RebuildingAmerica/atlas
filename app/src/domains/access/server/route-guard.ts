import { redirect } from "@tanstack/react-router";
import { getAtlasSession } from "../session.functions";

/**
 * Redirects unauthenticated operators into the sign-in flow.
 */
function redirectToSignIn(locationHref: string): never {
  // eslint-disable-next-line @typescript-eslint/only-throw-error
  throw redirect({
    to: "/sign-in",
    search: { redirect: locationHref },
  });
}

/**
 * Normalizes a stored redirect target back into an app-local path.
 */
function normalizeRedirectTarget(target: string | undefined, fallback: string): string {
  if (!target) {
    return fallback;
  }

  if (target.startsWith("/")) {
    return target;
  }

  try {
    const url = new URL(target);
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

/**
 * Chooses the post-auth destination for a ready session.
 *
 * Operators without a workspace yet, or with invitations waiting, should land
 * on organization setup before Atlas sends them into the rest of the
 * workspace.
 *
 * @param session - The current Atlas session payload.
 * @param redirectTo - The requested redirect target from the current route.
 */
function resolveReadySessionDestination(
  session: NonNullable<Awaited<ReturnType<typeof getAtlasSession>>>,
  redirectTo: string | undefined,
): string {
  if (
    session.workspace.onboarding.needsWorkspace ||
    session.workspace.onboarding.hasPendingInvitations
  ) {
    return "/organization";
  }

  return normalizeRedirectTarget(redirectTo, "/account");
}

/**
 * Protects app routes that require an authenticated operator session.
 *
 * In local mode this resolves immediately because `getAtlasSession()` returns
 * the synthetic local operator.
 */
export async function requireAtlasSession(locationHref: string) {
  const session = await getAtlasSession();
  if (!session) {
    redirectToSignIn(locationHref);
  }

  return session;
}

/**
 * Protects app routes that require a fully ready operator account.
 */
export async function requireReadyAtlasSession(locationHref: string) {
  const session = await getAtlasSession();
  if (!session) {
    redirectToSignIn(locationHref);
  }

  if (!session.accountReady) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({
      to: "/account-setup",
      search: { redirect: locationHref },
    });
  }

  return session;
}

/**
 * Protects the account-setup flow so only incomplete signed-in operators can
 * access it.
 */
export async function requireIncompleteAtlasSession(locationHref: string, redirectTo?: string) {
  const session = await getAtlasSession();
  if (!session) {
    redirectToSignIn(locationHref);
  }

  if (session.accountReady) {
    const destination = resolveReadySessionDestination(session, redirectTo);
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({
      to: destination,
    });
  }

  return session;
}
