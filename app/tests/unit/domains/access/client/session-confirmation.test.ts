import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  waitForAtlasAuthenticatedSession,
  waitForAtlasPasskeyRegistration,
} from "@/domains/access/client/session-confirmation";

describe("session-confirmation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("polls until the session is authenticated", async () => {
    const fetchSession = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ session: { id: "sess_123" }, user: { id: "user_123" } });

    const promise = waitForAtlasAuthenticatedSession(fetchSession);
    await vi.runAllTimersAsync();
    const session = await promise;

    expect(session.session.id).toBe("sess_123");
    expect(fetchSession).toHaveBeenCalledTimes(2);
  });

  it("throws when the session is never confirmed", async () => {
    const fetchSession = vi.fn().mockResolvedValue(null);

    const promise = waitForAtlasAuthenticatedSession(fetchSession);
    const expectation = expect(promise).rejects.toThrow(
      "Atlas could not confirm your session after passkey sign-in.",
    );
    await vi.runAllTimersAsync();
    await expectation;
  });

  it("polls until a passkey is registered", async () => {
    const fetchSession = vi
      .fn()
      .mockResolvedValueOnce({ hasPasskey: false })
      .mockResolvedValueOnce({ hasPasskey: true });

    const promise = waitForAtlasPasskeyRegistration(fetchSession);
    await vi.runAllTimersAsync();
    const session = await promise;

    expect(session.hasPasskey).toBe(true);
    expect(fetchSession).toHaveBeenCalledTimes(2);
  });
});
