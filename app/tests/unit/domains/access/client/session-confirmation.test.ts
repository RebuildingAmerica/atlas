import { describe, expect, it, vi } from "vitest";
import {
  waitForAtlasAuthenticatedSession,
  waitForAtlasPasskeyRegistration,
} from "@/domains/access/client/session-confirmation";

describe("session-confirmation", () => {
  it("polls until the session is authenticated", async () => {
    const fetchSession = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ session: { id: "sess_123" }, user: { id: "user_123" } });

    const session = await waitForAtlasAuthenticatedSession(fetchSession);

    expect(session.session.id).toBe("sess_123");
    expect(fetchSession).toHaveBeenCalledTimes(2);
  });

  it("throws when the session is never confirmed", async () => {
    // Use a fetcher that always returns null so the poller exhausts its
    // time ceiling.  Override setTimeout to fire instantly so the test
    // completes without a 15-second wall-clock wait.
    const originalSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((fn: () => void) => originalSetTimeout(fn, 0)) as typeof setTimeout;

    const fetchSession = vi.fn().mockResolvedValue(null);

    try {
      await expect(waitForAtlasAuthenticatedSession(fetchSession)).rejects.toThrow(
        "Atlas could not confirm your session after passkey sign-in.",
      );
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }
  });

  it("polls until a passkey is registered", async () => {
    const fetchSession = vi
      .fn()
      .mockResolvedValueOnce({ hasPasskey: false })
      .mockResolvedValueOnce({ hasPasskey: true });

    const session = await waitForAtlasPasskeyRegistration(fetchSession);

    expect(session.hasPasskey).toBe(true);
    expect(fetchSession).toHaveBeenCalledTimes(2);
  });
});
