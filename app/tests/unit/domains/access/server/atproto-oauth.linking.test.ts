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

  it("persists only the public result of a managed PDS provisioning request", async () => {
    managedPdsMocks.provisionManagedAtprotoIdentity.mockResolvedValue({
      current_handle: "civic.atlas.test",
      did: "did:plc:managed",
      pds_url: "https://pds.atlas.test",
    });
    mocks().fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          current_handle: "civic.atlas.test",
          did: "did:plc:managed",
          id: "identity_managed",
          pds_url: "https://pds.atlas.test",
        }),
        { status: 201 },
      ),
    );
    const { provisionAndLinkManagedAtprotoIdentity } =
      await import("@/domains/access/server/atproto-oauth");

    await expect(
      provisionAndLinkManagedAtprotoIdentity({ handle: "civic.atlas.test" }),
    ).resolves.toEqual({
      current_handle: "civic.atlas.test",
      did: "did:plc:managed",
      id: "identity_managed",
      pds_url: "https://pds.atlas.test",
    });

    expect(managedPdsMocks.provisionManagedAtprotoIdentity).toHaveBeenCalledWith({
      email: "operator@atlas.test",
      handle: "civic.atlas.test",
      userId: "user_1",
    });
    const [, request] = mocks().fetch.mock.calls[0] as [URL, RequestInit];
    if (typeof request.body !== "string") {
      throw new Error("Expected a JSON provisioning persistence body.");
    }
    expect(JSON.parse(request.body)).toEqual({
      current_handle: "civic.atlas.test",
      did: "did:plc:managed",
      pds_url: "https://pds.atlas.test",
    });
  });

  it("persists the callback identity only after the DID resolves back to the returned handle", async () => {
    const get = vi.fn().mockReturnValue({
      value: JSON.stringify({
        requestedHandle: "org.example",
        returnTo: "/claim/org",
        userId: "user_1",
      }),
    });
    const run = vi.fn();
    const prepare = vi.fn().mockReturnValue({ get, run });
    mocks().getAuthDatabase.mockReturnValue({
      prepare,
    });
    mocks().getTokenInfo.mockResolvedValue({ aud: "https://pds.example" });
    mocks().callback.mockResolvedValue({
      state: "state_1",
      session: {
        did: "did:plc:org",
        getTokenInfo: mocks().getTokenInfo,
      },
    });
    mocks().getProfile.mockResolvedValue({
      data: { did: "did:plc:org", handle: "org.example" },
    });
    mocks().resolveIdentity.mockResolvedValue({
      data: {
        did: "did:plc:org",
        handle: "org.example",
        didDoc: { id: "did:plc:org" },
      },
    });
    mocks().fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          current_handle: "org.example",
          did: "did:plc:org",
          id: "identity_1",
          pds_url: "https://pds.example",
        }),
        { status: 201 },
      ),
    );
    const { completeAtprotoAuthorization } = await import("@/domains/access/server/atproto-oauth");

    const redirectUrl = await completeAtprotoAuthorization(
      new URLSearchParams("code=abc&state=state_1"),
    );

    expect(mocks().resolveIdentity).toHaveBeenCalledWith({
      identifier: "did:plc:org",
    });
    const fetchCalls = mocks().fetch.mock.calls as [URL | string, RequestInit][];
    const fetchCall = fetchCalls[0];
    if (!fetchCall) throw new Error("Expected identity persistence request");
    const [fetchUrl, fetchInit] = fetchCall;
    expect(String(fetchUrl)).toBe("https://api.atlas.test/api/atproto/identities");
    expect(fetchInit.method).toBe("POST");
    if (typeof fetchInit.body !== "string") {
      throw new Error("Expected JSON identity persistence body");
    }
    expect(JSON.parse(fetchInit.body)).toEqual({
      current_handle: "org.example",
      did: "did:plc:org",
      pds_url: "https://pds.example",
    });
    expect(redirectUrl).toBe(
      "https://atlas.test/claim/org?atprotoStatus=connected&atprotoIdentityId=identity_1",
    );
    expect(prepare).toHaveBeenCalledWith("DELETE FROM atproto_oauth_state WHERE key = ?");
    expect(prepare).toHaveBeenCalledWith("DELETE FROM atproto_oauth_session WHERE key = ?");
    expect(run).toHaveBeenCalledWith("state_1");
    expect(run).toHaveBeenCalledWith("did:plc:org");
  });

  it("removes stale callback errors from successful redirects", async () => {
    const get = vi.fn().mockReturnValue({
      value: JSON.stringify({
        requestedHandle: "org.example",
        returnTo:
          "/claim/org?atprotoError=ATProto+identity+could+not+be+verified.&atprotoHandle=org.example",
        userId: "user_1",
      }),
    });
    const run = vi.fn();
    mocks().getAuthDatabase.mockReturnValue({
      prepare: vi.fn().mockReturnValue({ get, run }),
    });
    mocks().getTokenInfo.mockResolvedValue({ aud: "https://pds.example" });
    mocks().callback.mockResolvedValue({
      state: "state_1",
      session: {
        did: "did:plc:org",
        getTokenInfo: mocks().getTokenInfo,
      },
    });
    mocks().getProfile.mockResolvedValue({
      data: { did: "did:plc:org", handle: "org.example" },
    });
    mocks().resolveIdentity.mockResolvedValue({
      data: {
        did: "did:plc:org",
        handle: "org.example",
        didDoc: { id: "did:plc:org" },
      },
    });
    mocks().fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          current_handle: "org.example",
          did: "did:plc:org",
          id: "identity_1",
          pds_url: "https://pds.example",
        }),
        { status: 201 },
      ),
    );
    const { completeAtprotoAuthorization } = await import("@/domains/access/server/atproto-oauth");

    const redirectUrl = await completeAtprotoAuthorization(
      new URLSearchParams("code=abc&state=state_1"),
    );

    expect(redirectUrl).toBe(
      "https://atlas.test/claim/org?atprotoStatus=connected&atprotoIdentityId=identity_1",
    );
  });

  it("returns a signed-in operator to the identity section after a verified account link", async () => {
    mocks().getAuthRuntimeConfig.mockReturnValue({
      internalSecret: "secret", // pragma: allowlist secret - test fixture
      publicBaseUrl: "https://atlas.test",
    });
    const get = vi.fn().mockReturnValue({
      value: JSON.stringify({
        requestedHandle: "operator.example",
        returnTo: "/account",
        userId: "user_1",
      }),
    });
    mocks().getAuthDatabase.mockReturnValue({
      prepare: vi.fn().mockReturnValue({ get, run: vi.fn() }),
    });
    mocks().getTokenInfo.mockResolvedValue({ aud: "https://pds.example" });
    mocks().callback.mockResolvedValue({
      state: "state_1",
      session: { did: "did:plc:operator", getTokenInfo: mocks().getTokenInfo },
    });
    mocks().getProfile.mockResolvedValue({
      data: { did: "did:plc:operator", handle: "operator.example" },
    });
    mocks().resolveIdentity.mockResolvedValue({
      data: {
        did: "did:plc:operator",
        didDoc: { id: "did:plc:operator" },
        handle: "operator.example",
      },
    });
    mocks().fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          current_handle: "operator.example",
          did: "did:plc:operator",
          id: "identity_operator",
          pds_url: "https://pds.example",
        }),
        { status: 201 },
      ),
    );
    const { completeAtprotoOAuthCallback } = await import("@/domains/access/server/atproto-oauth");

    const response = await completeAtprotoOAuthCallback(
      new URLSearchParams("code=abc&state=state_1"),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      "https://atlas.test/account?atprotoStatus=connected&atprotoIdentityId=identity_operator#identity",
    );
    expect(String(mocks().fetch.mock.calls[0]?.[0])).toBe(
      "https://atlas.test/api/atproto/identities",
    );
  });

  it("rejects the callback when resolved ATProto identity no longer matches the profile handle", async () => {
    const get = vi.fn().mockReturnValue({
      value: JSON.stringify({
        requestedHandle: "org.example",
        returnTo: "/claim/org",
        userId: "user_1",
      }),
    });
    mocks().getAuthDatabase.mockReturnValue({
      prepare: vi.fn().mockReturnValue({ get, run: vi.fn() }),
    });
    mocks().getTokenInfo.mockResolvedValue({ aud: "https://pds.example" });
    mocks().callback.mockResolvedValue({
      state: "state_1",
      session: {
        did: "did:plc:org",
        getTokenInfo: mocks().getTokenInfo,
      },
    });
    mocks().getProfile.mockResolvedValue({
      data: { did: "did:plc:org", handle: "org.example" },
    });
    mocks().resolveIdentity.mockResolvedValue({
      data: {
        did: "did:plc:org",
        handle: "handle.invalid",
        didDoc: { id: "did:plc:org" },
      },
    });
    const { completeAtprotoAuthorization } = await import("@/domains/access/server/atproto-oauth");

    await expect(
      completeAtprotoAuthorization(new URLSearchParams("code=abc&state=state_1")),
    ).rejects.toMatchObject({
      attemptedHandle: "org.example",
      message: "ATProto identity could not be verified.",
      returnTo: "/claim/org",
    });
    expect(mocks().fetch).not.toHaveBeenCalled();
  });

  it("cleans provider OAuth rows when Atlas app state belongs to a different session", async () => {
    const get = vi.fn().mockReturnValue({
      value: JSON.stringify({
        requestedHandle: "org.example",
        returnTo: "/claim/org",
        userId: "user_other",
      }),
    });
    const run = vi.fn();
    const prepare = vi.fn().mockReturnValue({ get, run });
    mocks().getAuthDatabase.mockReturnValue({
      prepare,
    });
    mocks().callback.mockResolvedValue({
      state: "state_1",
      session: {
        did: "did:plc:org",
        getTokenInfo: mocks().getTokenInfo,
      },
    });
    const { completeAtprotoAuthorization } = await import("@/domains/access/server/atproto-oauth");

    await expect(
      completeAtprotoAuthorization(new URLSearchParams("code=abc&state=state_1")),
    ).rejects.toThrow("ATProto verification state could not be matched to this session.");
    expect(mocks().getProfile).not.toHaveBeenCalled();
    expect(mocks().fetch).not.toHaveBeenCalled();
    expect(prepare).toHaveBeenCalledWith("DELETE FROM atproto_oauth_state WHERE key = ?");
    expect(prepare).toHaveBeenCalledWith("DELETE FROM atproto_oauth_session WHERE key = ?");
    expect(prepare).toHaveBeenCalledWith("DELETE FROM atproto_oauth_app_state WHERE key = ?");
    expect(run).toHaveBeenCalledWith("state_1");
    expect(run).toHaveBeenCalledWith("did:plc:org");
  });

  it("rejects the callback when the provider returns a different handle than requested", async () => {
    const get = vi.fn().mockReturnValue({
      value: JSON.stringify({
        requestedHandle: "org.example",
        returnTo: "/claim/org",
        userId: "user_1",
      }),
    });
    const run = vi.fn();
    const prepare = vi.fn().mockReturnValue({ get, run });
    mocks().getAuthDatabase.mockReturnValue({
      prepare,
    });
    mocks().getTokenInfo.mockResolvedValue({ aud: "https://pds.example" });
    mocks().callback.mockResolvedValue({
      state: "state_1",
      session: {
        did: "did:plc:other",
        getTokenInfo: mocks().getTokenInfo,
      },
    });
    mocks().getProfile.mockResolvedValue({
      data: { did: "did:plc:other", handle: "other.example" },
    });
    mocks().resolveIdentity.mockResolvedValue({
      data: {
        did: "did:plc:other",
        handle: "other.example",
        didDoc: { id: "did:plc:other" },
      },
    });
    const { completeAtprotoAuthorization } = await import("@/domains/access/server/atproto-oauth");

    await expect(
      completeAtprotoAuthorization(new URLSearchParams("code=abc&state=state_1")),
    ).rejects.toMatchObject({
      attemptedHandle: "org.example",
      message: "ATProto identity could not be verified.",
      returnTo: "/claim/org",
    });
    expect(mocks().fetch).not.toHaveBeenCalled();
    expect(prepare).toHaveBeenCalledWith("DELETE FROM atproto_oauth_state WHERE key = ?");
    expect(prepare).toHaveBeenCalledWith("DELETE FROM atproto_oauth_session WHERE key = ?");
    expect(run).toHaveBeenCalledWith("state_1");
    expect(run).toHaveBeenCalledWith("did:plc:other");
  });

  it("refuses a link callback whose profile does not match the DID that authorized", async () => {
    const get = vi.fn().mockReturnValue({
      value: JSON.stringify({
        requestedHandle: "org.example",
        returnTo: "/claim/org",
        userId: "user_1",
      }),
    });
    mocks().getAuthDatabase.mockReturnValue({
      prepare: vi.fn().mockReturnValue({ get, run: vi.fn() }),
    });
    mocks().getTokenInfo.mockResolvedValue({ aud: "https://pds.example" });
    mocks().callback.mockResolvedValue({
      state: "state_1",
      session: { did: "did:plc:org", getTokenInfo: mocks().getTokenInfo },
    });
    mocks().getProfile.mockResolvedValue({
      data: { did: "did:plc:impostor", handle: "org.example" },
    });
    const { completeAtprotoAuthorization } = await import("@/domains/access/server/atproto-oauth");

    await expect(
      completeAtprotoAuthorization(new URLSearchParams("code=abc&state=state_1")),
    ).rejects.toMatchObject({
      attemptedHandle: "org.example",
      message: "ATProto identity could not be verified.",
    });
    expect(mocks().fetch).not.toHaveBeenCalled();
  });

  it("reports a link that Atlas could not record, without losing the return destination", async () => {
    const get = vi.fn().mockReturnValue({
      value: JSON.stringify({
        requestedHandle: "org.example",
        returnTo: "/claim/org",
        userId: "user_1",
      }),
    });
    mocks().getAuthDatabase.mockReturnValue({
      prepare: vi.fn().mockReturnValue({ get, run: vi.fn() }),
    });
    mocks().getTokenInfo.mockResolvedValue({ aud: "https://pds.example" });
    mocks().callback.mockResolvedValue({
      state: "state_1",
      session: { did: "did:plc:org", getTokenInfo: mocks().getTokenInfo },
    });
    mocks().getProfile.mockResolvedValue({
      data: { did: "did:plc:org", handle: "org.example" },
    });
    mocks().resolveIdentity.mockResolvedValue({
      data: { did: "did:plc:org", didDoc: { id: "did:plc:org" }, handle: "org.example" },
    });
    mocks().fetch.mockResolvedValue(new Response(null, { status: 500 }));
    const { completeAtprotoAuthorization } = await import("@/domains/access/server/atproto-oauth");

    await expect(
      completeAtprotoAuthorization(new URLSearchParams("code=abc&state=state_1")),
    ).rejects.toMatchObject({
      attemptedHandle: "org.example",
      message: "ATProto identity could not be linked.",
      returnTo: "/claim/org",
    });
  });
});
