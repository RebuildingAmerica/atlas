import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAtprotoOAuthMocks as mocks,
  setupAtprotoOAuthMocks,
} from "./atproto-oauth-test-support";

const managedPdsMocks = vi.hoisted(() => ({
  provisionManagedAtprotoIdentity: vi.fn(),
}));

const atprotoSignInMocks = vi.hoisted(() => ({
  createAtprotoSessionForUser: vi.fn(),
}));

vi.mock("@/domains/access/server/atproto-pds", () => ({
  provisionManagedAtprotoIdentity: managedPdsMocks.provisionManagedAtprotoIdentity,
}));

vi.mock("@/domains/access/server/atproto-sign-in", () => ({
  createAtprotoSessionForUser: atprotoSignInMocks.createAtprotoSessionForUser,
}));

describe("atproto-oauth", () => {
  beforeEach(() => {
    setupAtprotoOAuthMocks();
    managedPdsMocks.provisionManagedAtprotoIdentity.mockReset();
    atprotoSignInMocks.createAtprotoSessionForUser.mockReset();
  });

  it("creates a Better Auth session only after a verified DID resolves to an active controller", async () => {
    const get = vi.fn().mockReturnValue({
      value: JSON.stringify({
        flow: "sign-in",
        requestedHandle: "person.example",
        returnTo: "/account",
      }),
    });
    const run = vi.fn();
    mocks().getAuthDatabase.mockReturnValue({
      prepare: vi.fn().mockReturnValue({ get, run }),
    });
    mocks().callback.mockResolvedValue({
      state: "state_1",
      session: { did: "did:plc:person", getTokenInfo: mocks().getTokenInfo },
    });
    mocks().getProfile.mockResolvedValue({
      data: { did: "did:plc:person", handle: "person.example" },
    });
    mocks().resolveIdentity.mockResolvedValue({
      data: {
        did: "did:plc:person",
        didDoc: { id: "did:plc:person" },
        handle: "person.example",
      },
    });
    mocks().fetch.mockResolvedValue(new Response(JSON.stringify({ user_id: "user_1" })));
    atprotoSignInMocks.createAtprotoSessionForUser.mockResolvedValue(
      new Response(null, { headers: { "set-cookie": "session=opaque; HttpOnly" }, status: 204 }),
    );
    const { completeAtprotoSignIn } = await import("@/domains/access/server/atproto-oauth");

    const response = await completeAtprotoSignIn(new URLSearchParams("code=abc&state=state_1"));

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://atlas.test/account");
    expect(response.headers.get("set-cookie")).toContain("session=opaque");
    expect(atprotoSignInMocks.createAtprotoSessionForUser).toHaveBeenCalledWith("user_1");
    const [requestUrl, requestInit] = mocks().fetch.mock.calls[0] as [URL, RequestInit];
    expect(String(requestUrl)).toBe(
      "https://api.atlas.test/api/atproto/identities/sign-in/resolve",
    );
    if (typeof requestInit.body !== "string") {
      throw new Error("Expected an internal sign-in resolution request body.");
    }
    expect(JSON.parse(requestInit.body)).toEqual({ did: "did:plc:person" });
  });

  it("sends the shared provider callback to sign-in when that is the pending flow", async () => {
    const get = vi.fn().mockReturnValue({
      value: JSON.stringify({
        flow: "sign-in",
        requestedHandle: "person.example",
        returnTo: "/account",
      }),
    });
    mocks().getAuthDatabase.mockReturnValue({
      prepare: vi.fn().mockReturnValue({ get, run: vi.fn() }),
    });
    mocks().callback.mockResolvedValue({
      state: "state_1",
      session: { did: "did:plc:person", getTokenInfo: mocks().getTokenInfo },
    });
    mocks().getProfile.mockResolvedValue({
      data: { did: "did:plc:person", handle: "person.example" },
    });
    mocks().resolveIdentity.mockResolvedValue({
      data: { did: "did:plc:person", didDoc: { id: "did:plc:person" }, handle: "person.example" },
    });
    mocks().fetch.mockResolvedValue(new Response(JSON.stringify({ user_id: "user_1" })));
    atprotoSignInMocks.createAtprotoSessionForUser.mockResolvedValue(
      new Response(null, { headers: { "set-cookie": "session=opaque; HttpOnly" }, status: 204 }),
    );
    const { completeAtprotoOAuthCallback } = await import("@/domains/access/server/atproto-oauth");

    const response = await completeAtprotoOAuthCallback(
      new URLSearchParams("code=abc&state=state_1"),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://atlas.test/account");
    expect(response.headers.get("set-cookie")).toContain("session=opaque");
  });

  it("refuses a callback that carries no state at all", async () => {
    mocks().getAuthDatabase.mockReturnValue({
      prepare: vi.fn().mockReturnValue({ get: vi.fn(), run: vi.fn() }),
    });
    mocks().callback.mockResolvedValue({
      session: { did: "did:plc:person", getTokenInfo: mocks().getTokenInfo },
    });
    const { completeAtprotoOAuthCallback } = await import("@/domains/access/server/atproto-oauth");

    await expect(completeAtprotoOAuthCallback(new URLSearchParams("code=abc"))).rejects.toThrow(
      "ATProto verification state could not be matched to this session.",
    );
  });

  it("refuses a sign-in callback whose stored state belongs to a linking flow", async () => {
    const get = vi.fn().mockReturnValue({
      value: JSON.stringify({ requestedHandle: "person.example", returnTo: "/account" }),
    });
    mocks().getAuthDatabase.mockReturnValue({
      prepare: vi.fn().mockReturnValue({ get, run: vi.fn() }),
    });
    mocks().callback.mockResolvedValue({
      state: "state_1",
      session: { did: "did:plc:person", getTokenInfo: mocks().getTokenInfo },
    });
    const { completeAtprotoSignIn } = await import("@/domains/access/server/atproto-oauth");

    await expect(
      completeAtprotoSignIn(new URLSearchParams("code=abc&state=state_1")),
    ).rejects.toThrow("ATProto sign-in is unavailable.");
    expect(mocks().getProfile).not.toHaveBeenCalled();
  });

  it("refuses a sign-in whose profile does not match the DID that authorized", async () => {
    const get = vi.fn().mockReturnValue({
      value: JSON.stringify({
        flow: "sign-in",
        requestedHandle: "person.example",
        returnTo: "/account",
      }),
    });
    mocks().getAuthDatabase.mockReturnValue({
      prepare: vi.fn().mockReturnValue({ get, run: vi.fn() }),
    });
    mocks().callback.mockResolvedValue({
      state: "state_1",
      session: { did: "did:plc:person", getTokenInfo: mocks().getTokenInfo },
    });
    mocks().getProfile.mockResolvedValue({
      data: { did: "did:plc:impostor", handle: "person.example" },
    });
    const { completeAtprotoSignIn } = await import("@/domains/access/server/atproto-oauth");

    await expect(
      completeAtprotoSignIn(new URLSearchParams("code=abc&state=state_1")),
    ).rejects.toThrow("ATProto sign-in is unavailable.");
    expect(atprotoSignInMocks.createAtprotoSessionForUser).not.toHaveBeenCalled();
  });

  it("refuses a sign-in whose DID document does not resolve back to the same DID", async () => {
    const get = vi.fn().mockReturnValue({
      value: JSON.stringify({
        flow: "sign-in",
        requestedHandle: "person.example",
        returnTo: "/account",
      }),
    });
    mocks().getAuthDatabase.mockReturnValue({
      prepare: vi.fn().mockReturnValue({ get, run: vi.fn() }),
    });
    mocks().callback.mockResolvedValue({
      state: "state_1",
      session: { did: "did:plc:person", getTokenInfo: mocks().getTokenInfo },
    });
    mocks().getProfile.mockResolvedValue({
      data: { did: "did:plc:person", handle: "person.example" },
    });
    mocks().resolveIdentity.mockResolvedValue({
      data: { did: "did:plc:person", didDoc: null, handle: "person.example" },
    });
    const { completeAtprotoSignIn } = await import("@/domains/access/server/atproto-oauth");

    await expect(
      completeAtprotoSignIn(new URLSearchParams("code=abc&state=state_1")),
    ).rejects.toThrow("ATProto sign-in is unavailable.");
    expect(mocks().fetch).not.toHaveBeenCalled();
  });

  it("refuses a sign-in when Atlas has no passkey-ready controller for the DID", async () => {
    const get = vi.fn().mockReturnValue({
      value: JSON.stringify({
        flow: "sign-in",
        requestedHandle: "person.example",
        returnTo: "/account",
      }),
    });
    mocks().getAuthDatabase.mockReturnValue({
      prepare: vi.fn().mockReturnValue({ get, run: vi.fn() }),
    });
    mocks().getAuthRuntimeConfig.mockReturnValue({
      apiBaseUrl: null,
      internalSecret: "secret",
      publicBaseUrl: "https://atlas.test",
    });
    mocks().callback.mockResolvedValue({
      state: "state_1",
      session: { did: "did:plc:person", getTokenInfo: mocks().getTokenInfo },
    });
    mocks().getProfile.mockResolvedValue({
      data: { did: "did:plc:person", handle: "person.example" },
    });
    mocks().resolveIdentity.mockResolvedValue({
      data: { did: "did:plc:person", didDoc: { id: "did:plc:person" }, handle: "person.example" },
    });
    mocks().fetch.mockResolvedValue(new Response(null, { status: 404 }));
    const { completeAtprotoSignIn } = await import("@/domains/access/server/atproto-oauth");

    await expect(
      completeAtprotoSignIn(new URLSearchParams("code=abc&state=state_1")),
    ).rejects.toThrow("ATProto sign-in is unavailable.");
    expect(String(mocks().fetch.mock.calls[0]?.[0])).toBe(
      "https://atlas.test/api/atproto/identities/sign-in/resolve",
    );
    expect(atprotoSignInMocks.createAtprotoSessionForUser).not.toHaveBeenCalled();
  });

  it("refuses a sign-in when the controller lookup returns no user id", async () => {
    const get = vi.fn().mockReturnValue({
      value: JSON.stringify({
        flow: "sign-in",
        requestedHandle: "person.example",
        returnTo: "/account",
      }),
    });
    mocks().getAuthDatabase.mockReturnValue({
      prepare: vi.fn().mockReturnValue({ get, run: vi.fn() }),
    });
    mocks().callback.mockResolvedValue({
      state: "state_1",
      session: { did: "did:plc:person", getTokenInfo: mocks().getTokenInfo },
    });
    mocks().getProfile.mockResolvedValue({
      data: { did: "did:plc:person", handle: "person.example" },
    });
    mocks().resolveIdentity.mockResolvedValue({
      data: { did: "did:plc:person", didDoc: { id: "did:plc:person" }, handle: "person.example" },
    });
    mocks().fetch.mockResolvedValue(new Response(JSON.stringify({ user_id: "" })));
    const { completeAtprotoSignIn } = await import("@/domains/access/server/atproto-oauth");

    await expect(
      completeAtprotoSignIn(new URLSearchParams("code=abc&state=state_1")),
    ).rejects.toThrow("ATProto sign-in is unavailable.");
    expect(atprotoSignInMocks.createAtprotoSessionForUser).not.toHaveBeenCalled();
  });
});
