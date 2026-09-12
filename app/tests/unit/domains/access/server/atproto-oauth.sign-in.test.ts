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

  it("creates a Better Auth session through the hosted OAuth harness callback", async () => {
    const get = vi.fn().mockReturnValue({
      value: JSON.stringify({
        e2eHarness: true,
        flow: "sign-in",
        requestedHandle: "person.example",
        returnTo: "/account",
      }),
    });
    const run = vi.fn();
    mocks().getAuthDatabase.mockReturnValue({
      prepare: vi.fn().mockReturnValue({ get, run }),
    });
    mocks().fetch.mockResolvedValue(new Response(JSON.stringify({ user_id: "user_1" })));
    atprotoSignInMocks.createAtprotoSessionForUser.mockResolvedValue(
      new Response(null, { headers: { "set-cookie": "session=opaque; HttpOnly" }, status: 204 }),
    );
    const { completeAtprotoSignIn } = await import("@/domains/access/server/atproto-oauth");

    const response = await completeAtprotoSignIn(
      new URLSearchParams("code=atlas-e2e-harness&state=state_1&handle=person.example"),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://atlas.test/account");
    expect(response.headers.get("set-cookie")).toContain("session=opaque");
    expect(mocks().callback).not.toHaveBeenCalled();
    expect(atprotoSignInMocks.createAtprotoSessionForUser).toHaveBeenCalledWith("user_1");
    const [requestUrl, requestInit] = mocks().fetch.mock.calls[0] as [URL, RequestInit];
    expect(String(requestUrl)).toBe(
      "https://api.atlas.test/api/atproto/identities/sign-in/resolve",
    );
    if (typeof requestInit.body !== "string") {
      throw new Error("Expected an internal sign-in resolution request body.");
    }
    expect(JSON.parse(requestInit.body)).toEqual({ handle: "person.example" });
  });

  it("completes the end-to-end OAuth harness without calling the external ATProto client", async () => {
    vi.stubEnv("ATLAS_ATPROTO_OAUTH_E2E_HARNESS", "1");
    const get = vi.fn().mockReturnValue({
      value: JSON.stringify({
        requestedHandle: "org.example",
        returnTo: "/claim/org",
        userId: "user_1",
      }),
    });
    const run = vi.fn();
    mocks().getAuthDatabase.mockReturnValue({
      prepare: vi.fn().mockReturnValue({ get, run }),
    });
    mocks().fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          current_handle: "org.example",
          did: "did:web:org.example",
          id: "identity_harness",
          pds_url: "https://pds.atlas-e2e.test",
        }),
        { status: 201 },
      ),
    );
    const { completeAtprotoAuthorization } = await import("@/domains/access/server/atproto-oauth");

    const redirectUrl = await completeAtprotoAuthorization(
      new URLSearchParams("code=atlas-e2e-harness&state=state_1&handle=org.example"),
    );

    expect(mocks().callback).not.toHaveBeenCalled();
    expect(mocks().getProfile).not.toHaveBeenCalled();
    const fetchCalls = mocks().fetch.mock.calls as [URL | string, RequestInit][];
    const fetchCall = fetchCalls[0];
    if (!fetchCall) throw new Error("Expected identity persistence request");
    const [, fetchInit] = fetchCall;
    if (typeof fetchInit.body !== "string") {
      throw new Error("Expected JSON identity persistence body");
    }
    expect(JSON.parse(fetchInit.body)).toEqual({
      current_handle: "org.example",
      did: "did:web:org.example",
      pds_url: "https://pds.atlas-e2e.test",
    });
    expect(redirectUrl).toBe(
      "https://atlas.test/claim/org?atprotoStatus=connected&atprotoIdentityId=identity_harness",
    );
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

  it("refuses a synthetic sign-in callback whose stored state was not harness-authorized", async () => {
    vi.stubEnv("ATLAS_ATPROTO_OAUTH_E2E_HARNESS", "1");
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
    mocks().fetch.mockResolvedValue(new Response(JSON.stringify({ user_id: "user_1" })));
    atprotoSignInMocks.createAtprotoSessionForUser.mockResolvedValue(
      new Response(null, { headers: { "set-cookie": "session=opaque; HttpOnly" }, status: 204 }),
    );
    const { completeAtprotoSignIn } = await import("@/domains/access/server/atproto-oauth");

    await expect(
      completeAtprotoSignIn(
        new URLSearchParams("code=atlas-e2e-harness&state=state_1&handle=person.example"),
      ),
    ).rejects.toThrow("ATProto sign-in is unavailable.");
    expect(atprotoSignInMocks.createAtprotoSessionForUser).not.toHaveBeenCalled();
  });

  it("refuses a harness sign-in whose state or handle does not line up", async () => {
    vi.stubEnv("ATLAS_ATPROTO_OAUTH_E2E_HARNESS", "1");
    const get = vi.fn().mockReturnValue({
      value: JSON.stringify({
        e2eHarness: true,
        flow: "sign-in",
        requestedHandle: "person.example",
        returnTo: "/account",
      }),
    });
    mocks().getAuthDatabase.mockReturnValue({
      prepare: vi.fn().mockReturnValue({ get, run: vi.fn() }),
    });
    const { completeAtprotoSignIn } = await import("@/domains/access/server/atproto-oauth");

    await expect(
      completeAtprotoSignIn(new URLSearchParams("code=atlas-e2e-harness&state=state_1")),
    ).rejects.toThrow("ATProto sign-in is unavailable.");
    await expect(
      completeAtprotoSignIn(
        new URLSearchParams("code=atlas-e2e-harness&state=state_1&handle=impostor.example"),
      ),
    ).rejects.toThrow("ATProto sign-in is unavailable.");
    expect(atprotoSignInMocks.createAtprotoSessionForUser).not.toHaveBeenCalled();
  });

  it("refuses a harness callback that arrives without any state", async () => {
    vi.stubEnv("ATLAS_ATPROTO_OAUTH_E2E_HARNESS", "1");
    mocks().getAuthDatabase.mockReturnValue({
      prepare: vi.fn().mockReturnValue({ get: vi.fn(), run: vi.fn() }),
    });
    const { completeAtprotoAuthorization, completeAtprotoSignIn } =
      await import("@/domains/access/server/atproto-oauth");

    await expect(
      completeAtprotoSignIn(new URLSearchParams("code=atlas-e2e-harness&handle=person.example")),
    ).rejects.toThrow("ATProto sign-in is unavailable.");
    await expect(
      completeAtprotoAuthorization(
        new URLSearchParams("code=atlas-e2e-harness&handle=org.example"),
      ),
    ).rejects.toThrow("ATProto verification state could not be matched to this session.");
  });

  it("refuses a harness sign-in whose stored state is for a linking flow", async () => {
    vi.stubEnv("ATLAS_ATPROTO_OAUTH_E2E_HARNESS", "1");
    const get = vi.fn().mockReturnValue({
      value: JSON.stringify({ requestedHandle: "person.example", returnTo: "/account" }),
    });
    mocks().getAuthDatabase.mockReturnValue({
      prepare: vi.fn().mockReturnValue({ get, run: vi.fn() }),
    });
    const { completeAtprotoSignIn } = await import("@/domains/access/server/atproto-oauth");

    await expect(
      completeAtprotoSignIn(
        new URLSearchParams("code=atlas-e2e-harness&state=state_1&handle=person.example"),
      ),
    ).rejects.toThrow("ATProto sign-in is unavailable.");
  });
});
