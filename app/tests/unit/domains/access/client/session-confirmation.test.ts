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

    const session = await waitForAtlasAuthenticatedSession(fetchSession, 5);

    expect(session.session.id).toBe("sess_123");
    expect(fetchSession).toHaveBeenCalledTimes(2);
  });

  it("throws after reaching the max attempts", async () => {
    const fetchSession = vi.fn().mockResolvedValue(null);

    await expect(waitForAtlasAuthenticatedSession(fetchSession, 2)).rejects.toThrow(
      "Atlas could not confirm your session after passkey sign-in.",
    );
    expect(fetchSession).toHaveBeenCalledTimes(2);
  });

  it("polls until a passkey is registered", async () => {
    const fetchSession = vi
      .fn()
      .mockResolvedValueOnce({ hasPasskey: false })
      .mockResolvedValueOnce({ hasPasskey: true });

    const session = await waitForAtlasPasskeyRegistration(fetchSession, 5);

    expect(session.hasPasskey).toBe(true);
    expect(fetchSession).toHaveBeenCalledTimes(2);
  });
});
