import { getAtlasSession, type AtlasSessionPayload } from "../session.functions";

const SESSION_POLL_DELAY_MS = 200;
const SESSION_POLL_MAX_ATTEMPTS = 25;

type AtlasSessionFetcher = () => Promise<AtlasSessionPayload | null>;
type AtlasSessionPredicate = (session: AtlasSessionPayload | null) => boolean;

async function waitForAtlasSessionState(
  predicate: AtlasSessionPredicate,
  errorMessage: string,
  fetchSession: AtlasSessionFetcher = getAtlasSession,
  maxAttempts = SESSION_POLL_MAX_ATTEMPTS,
): Promise<AtlasSessionPayload> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const session = await fetchSession();
    if (session && predicate(session)) {
      return session;
    }

    await new Promise((resolve) => setTimeout(resolve, SESSION_POLL_DELAY_MS));
  }

  throw new Error(errorMessage);
}

/**
 * Waits until Atlas confirms the browser has an authenticated operator
 * session.
 */
export async function waitForAtlasAuthenticatedSession(
  fetchSession?: AtlasSessionFetcher,
  maxAttempts?: number,
): Promise<AtlasSessionPayload> {
  return await waitForAtlasSessionState(
    (session) => Boolean(session?.session.id && session.user.id),
    "Atlas could not confirm your session after passkey sign-in.",
    fetchSession,
    maxAttempts,
  );
}

/**
 * Waits until Atlas confirms the current account has a registered passkey.
 */
export async function waitForAtlasPasskeyRegistration(
  fetchSession?: AtlasSessionFetcher,
  maxAttempts?: number,
): Promise<AtlasSessionPayload> {
  return await waitForAtlasSessionState(
    (session) => Boolean(session?.hasPasskey),
    "Atlas could not confirm your passkey registration.",
    fetchSession,
    maxAttempts,
  );
}
