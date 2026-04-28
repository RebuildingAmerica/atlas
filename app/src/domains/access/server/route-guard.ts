import { redirect } from "@tanstack/react-router";
import { getAtlasSession } from "../session.functions";
import { getAuthRuntimeConfig } from "./runtime";

/**
 * Route guards for TanStack Router `beforeLoad` hooks.
 *
 * These functions are the only safe way to perform session checks inside route
 * definitions. They are exported through `@/domains/access/server` and run as
 * server functions during both SSR and client-side navigation.
 *
 * **Do not import `getAtlasSession` (or anything from `session.functions`)
 * directly into route files.** Doing so pulls the server function module into
 * the client route chunk, which breaks React Query's QueryClient initialization
 * during route resolution. Always use the guards from this module instead.
 *
 * ## Local mode
 *
 * When Atlas runs in local/single-user mode (`session.isLocal === true`), all
 * auth, billing, account, and organization UI must be completely hidden. Any
 * route that surfaces account-specific UI should call `redirectIfLocalSession`
 * in its `beforeLoad` to redirect to a safe destination (usually `/discovery`).
 *
 * The public nav and home page also check `session.isLocal` via the
 * `useAtlasSession` hook (which is safe inside React components rendered under
 * the QueryClientProvider) to hide auth links and sign-up CTAs.
 */

/**
 * Redirects unauthenticated operators into the sign-in flow.
 */
function redirectToSignIn(locationHref: string): never {
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
 * Redirects to a target route when the session is a synthetic local operator.
 *
 * Use this in `beforeLoad` for any route that should not be reachable in
 * local/single-user mode (sign-in, sign-up, pricing, account, organization).
 *
 * @example
 * ```ts
 * export const Route = createFileRoute("/_auth/sign-in")({
 *   beforeLoad: () => redirectIfLocalSession("/discovery"),
 *   component: SignInPage,
 * });
 * ```
 *
 * @param to - The route to redirect to in local mode.
 */
export function redirectIfLocalSession(to: string) {
  const { localMode } = getAuthRuntimeConfig();
  if (localMode) {
    throw redirect({ to });
  }
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

    throw redirect({
      to: destination,
    });
  }

  return session;
}
