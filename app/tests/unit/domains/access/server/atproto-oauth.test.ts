import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAtprotoOAuthMocks as mocks,
  setupAtprotoOAuthMocks,
} from "./atproto-oauth-test-support";

describe("atproto-oauth", () => {
  function configureHarnessCallback(returnTo: string, responseStatus = 201) {
    vi.stubEnv("ATLAS_ATPROTO_OAUTH_E2E_HARNESS", "1");
    const get = vi.fn().mockReturnValue({
      value: JSON.stringify({
        requestedHandle: "org.example",
        returnTo,
        userId: "user_1",
      }),
    });
    mocks().getAuthDatabase.mockReturnValue({
      prepare: vi.fn().mockReturnValue({ get, run: vi.fn() }),
    });
    mocks().fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          current_handle: "org.example",
          did: "did:web:org.example",
          id: "identity_harness",
          pds_url: "https://pds.atlas-e2e.test",
        }),
        { status: responseStatus },
      ),
    );
  }

  beforeEach(() => {
    setupAtprotoOAuthMocks();
  });

  it("prunes old OAuth app-state rows before writing the next authorization state", async () => {
    const run = vi.fn();
    const prepare = vi.fn().mockReturnValue({ run });
    mocks().getAuthDatabase.mockReturnValue({ prepare });
    const { createAtprotoAuthorizationUrl } = await import("@/domains/access/server/atproto-oauth");

    await createAtprotoAuthorizationUrl({
      handle: "acme.org",
      returnTo: "/account#identity",
    });

    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("CREATE TABLE IF NOT EXISTS"));
    expect(prepare).toHaveBeenCalledWith(
      "DELETE FROM atproto_oauth_app_state WHERE updated_at < ?",
    );
    expect(prepare).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO atproto_oauth_app_state"),
    );
    const insertedPayload = String(run.mock.calls.at(-1)?.[1]);
    expect(insertedPayload).toContain('"returnTo":"/account#identity"');
    expect(insertedPayload).toContain('"requestedHandle":"acme.org"');
    const authorizeCalls = mocks().authorize.mock.calls as [string, { state: unknown }][];
    expect(authorizeCalls[0]?.[0]).toBe("acme.org");
    expect(typeof authorizeCalls[0]?.[1].state).toBe("string");
  });

  it("accepts only Account, claim, and manage return destinations", async () => {
    const { parseAtprotoReturnTo } = await import("@/domains/access/server/atproto-oauth");

    expect(parseAtprotoReturnTo("/account#identity")).toEqual({ kind: "account" });
    expect(parseAtprotoReturnTo("/claim/org-slug")).toEqual({ kind: "claim", slug: "org-slug" });
    expect(parseAtprotoReturnTo("/manage/org-slug")).toEqual({
      kind: "manage",
      slug: "org-slug",
    });
    expect(() => parseAtprotoReturnTo("/admin")).toThrow("not allowed");
    expect(() => parseAtprotoReturnTo("https://evil.example/claim/org")).toThrow("not allowed");
  });

  it("requires a signed-in Atlas session before starting OAuth", async () => {
    mocks().getAuthDatabase.mockReturnValue({
      prepare: vi.fn().mockReturnValue({ run: vi.fn() }),
    });
    mocks().loadAtlasSession.mockResolvedValue(null);
    const { createAtprotoAuthorizationUrl } = await import("@/domains/access/server/atproto-oauth");

    await expect(
      createAtprotoAuthorizationUrl({ handle: "org.example", returnTo: "/account" }),
    ).rejects.toThrow("Sign in before verifying an ATProto account.");
  });

  it("returns successful Account callbacks to the Identity section", async () => {
    configureHarnessCallback("/account#identity");
    const { completeAtprotoAuthorization } = await import("@/domains/access/server/atproto-oauth");

    await expect(
      completeAtprotoAuthorization(
        new URLSearchParams("code=atlas-e2e-harness&state=state_1&handle=org.example"),
      ),
    ).resolves.toBe(
      "https://atlas.test/account?atprotoStatus=connected&atprotoIdentityId=identity_harness#identity",
    );
  });

  it("rejects a callback when Atlas cannot persist the verified identity", async () => {
    configureHarnessCallback("/manage/org", 409);
    const { completeAtprotoAuthorization } = await import("@/domains/access/server/atproto-oauth");

    await expect(
      completeAtprotoAuthorization(
        new URLSearchParams("code=atlas-e2e-harness&state=state_1&handle=org.example"),
      ),
    ).rejects.toThrow("ATProto identity could not be linked.");
  });

  it("builds an internal provider authorization URL when the end-to-end OAuth harness is enabled", async () => {
    vi.stubEnv("ATLAS_ATPROTO_OAUTH_E2E_HARNESS", "1");
    const run = vi.fn();
    const prepare = vi.fn().mockReturnValue({ run });
    mocks().getAuthDatabase.mockReturnValue({ prepare });
    const { createAtprotoAuthorizationUrl } = await import("@/domains/access/server/atproto-oauth");

    const authorizationUrl = await createAtprotoAuthorizationUrl({
      handle: "org.example",
      returnTo: "/claim/org",
    });

    expect(mocks().authorize).not.toHaveBeenCalled();
    expect(authorizationUrl.origin).toBe("https://atlas.test");
    expect(authorizationUrl.pathname).toBe("/api/atproto/oauth/harness/authorize");
    expect(authorizationUrl.searchParams.get("handle")).toBe("org.example");
    expect(authorizationUrl.searchParams.get("state")).toEqual(expect.any(String));
  });

  it("builds a callback URL from the internal provider harness", async () => {
    const { createAtprotoHarnessProviderCallbackUrl } =
      await import("@/domains/access/server/atproto-oauth");

    const callbackUrl = createAtprotoHarnessProviderCallbackUrl(
      new URLSearchParams("state=state_1&handle=org.example"),
    );

    expect(callbackUrl.toString()).toBe(
      "https://atlas.test/api/atproto/oauth/callback?code=atlas-e2e-harness&state=state_1&handle=org.example",
    );
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
});
