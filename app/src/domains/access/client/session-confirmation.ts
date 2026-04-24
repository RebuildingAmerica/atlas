import { getAtlasSession, type AtlasSessionPayload } from "../session.functions";

const SESSION_POLL_INITIAL_DELAY_MS = 200;
const SESSION_POLL_MAX_DELAY_MS = 2000;
const SESSION_POLL_CEILING_MS = 15_000;

type AtlasSessionFetcher = () => Promise<AtlasSessionPayload | null>;
type AtlasSessionPredicate = (session: AtlasSessionPayload | null) => boolean;

async function waitForAtlasSessionState(
  predicate: AtlasSessionPredicate,
  errorMessage: string,
  fetchSession: AtlasSessionFetcher = getAtlasSession,
): Promise<AtlasSessionPayload> {
  let delay = SESSION_POLL_INITIAL_DELAY_MS;
  let elapsed = 0;

  while (elapsed < SESSION_POLL_CEILING_MS) {
    const session = await fetchSession();
    if (session && predicate(session)) {
      return session;
    }

    await new Promise((resolve) => setTimeout(resolve, delay));
    elapsed += delay;
    delay = Math.min(delay * 2, SESSION_POLL_MAX_DELAY_MS);
  }

  throw new Error(errorMessage);
}

/**
 * Waits until Atlas confirms the browser has an authenticated operator
 * session.
 */
export async function waitForAtlasAuthenticatedSession(
  fetchSession?: AtlasSessionFetcher,
): Promise<AtlasSessionPayload> {
  return await waitForAtlasSessionState(
    (session) => Boolean(session?.session.id && session.user.id),
    "Atlas could not confirm your session after passkey sign-in.",
    fetchSession,
  );
}

/**
 * Waits until Atlas confirms the current account has a registered passkey.
 */
export async function waitForAtlasPasskeyRegistration(
  fetchSession?: AtlasSessionFetcher,
): Promise<AtlasSessionPayload> {
  return await waitForAtlasSessionState(
    (session) => Boolean(session?.hasPasskey),
    "Atlas could not confirm your passkey registration.",
    fetchSession,
  );
}
