import { describe, expect, it, vi } from "vitest";
import {
  waitForAtlasAuthenticatedSession,
  waitForAtlasPasskeyRegistration,
} from "@/domains/access/client/session-confirmation";

describe("session-confirmation", () => {
  it("waits until Atlas reports an authenticated session", async () => {
    const fetchSession = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        accountReady: false,
        hasPasskey: false,
        isLocal: false,
        passkeyCount: 0,
        session: { id: "session_123" },
        user: {
          email: "operator@atlas.test",
          emailVerified: true,
          id: "user_123",
          name: "Operator",
        },
      });

    await expect(waitForAtlasAuthenticatedSession(fetchSession, 2)).resolves.toMatchObject({
      session: { id: "session_123" },
      user: { id: "user_123" },
    });
    expect(fetchSession).toHaveBeenCalledTimes(2);
  });

  it("keeps polling until the authenticated session includes both session and user ids", async () => {
    const fetchSession = vi
      .fn()
      .mockResolvedValueOnce({
        accountReady: false,
        hasPasskey: false,
        isLocal: false,
        passkeyCount: 0,
        session: { id: "" },
        user: {
          email: "operator@atlas.test",
          emailVerified: true,
          id: "user_123",
          name: "Operator",
        },
      })
      .mockResolvedValueOnce({
        accountReady: false,
        hasPasskey: false,
        isLocal: false,
        passkeyCount: 0,
        session: { id: "session_123" },
        user: {
          email: "operator@atlas.test",
          emailVerified: true,
          id: "user_123",
          name: "Operator",
        },
      });

    await expect(waitForAtlasAuthenticatedSession(fetchSession, 2)).resolves.toMatchObject({
      session: { id: "session_123" },
      user: { id: "user_123" },
    });
    expect(fetchSession).toHaveBeenCalledTimes(2);
  });

  it("waits until Atlas reports that a passkey is registered", async () => {
    const fetchSession = vi
      .fn()
      .mockResolvedValueOnce({
        accountReady: false,
        hasPasskey: false,
        isLocal: false,
        passkeyCount: 0,
        session: { id: "session_123" },
        user: {
          email: "operator@atlas.test",
          emailVerified: true,
          id: "user_123",
          name: "Operator",
        },
      })
      .mockResolvedValueOnce({
        accountReady: true,
        hasPasskey: true,
        isLocal: false,
        passkeyCount: 1,
        session: { id: "session_123" },
        user: {
          email: "operator@atlas.test",
          emailVerified: true,
          id: "user_123",
          name: "Operator",
        },
      });

    await expect(waitForAtlasPasskeyRegistration(fetchSession, 2)).resolves.toMatchObject({
      accountReady: true,
      hasPasskey: true,
      passkeyCount: 1,
    });
    expect(fetchSession).toHaveBeenCalledTimes(2);
  });

  it("throws when an authenticated session never appears", async () => {
    const fetchSession = vi.fn().mockResolvedValue(null);

    await expect(waitForAtlasAuthenticatedSession(fetchSession, 1)).rejects.toThrow(
      "Atlas could not confirm your session after passkey sign-in.",
    );
  });

  it("throws when passkey registration never appears", async () => {
    const fetchSession = vi.fn().mockResolvedValue({
      accountReady: false,
      hasPasskey: false,
      isLocal: false,
      passkeyCount: 0,
      session: { id: "session_123" },
      user: {
        email: "operator@atlas.test",
        emailVerified: true,
        id: "user_123",
        name: "Operator",
      },
    });

    await expect(waitForAtlasPasskeyRegistration(fetchSession, 1)).rejects.toThrow(
      "Atlas could not confirm your passkey registration.",
    );
  });
});
