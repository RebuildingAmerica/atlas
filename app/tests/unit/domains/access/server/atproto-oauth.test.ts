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

  it("starts an ATProto sign-in authorization without an existing Atlas session", async () => {
    mocks().loadAtlasSession.mockResolvedValue(null);
    const run = vi.fn();
    mocks().getAuthDatabase.mockReturnValue({
      prepare: vi.fn().mockReturnValue({ run }),
    });
    const { createAtprotoSignInAuthorizationUrl } =
      await import("@/domains/access/server/atproto-oauth");

    await expect(
      createAtprotoSignInAuthorizationUrl({
        handle: "person.example",
        returnTo: "/account",
        useE2EHarness: false,
      }),
    ).resolves.toEqual(new URL("https://bsky.social/oauth/authorize"));

    const insertedPayload = String(run.mock.calls.at(-1)?.[1]);
    expect(insertedPayload).toContain('"flow":"sign-in"');
    expect(insertedPayload).toContain('"requestedHandle":"person.example"');
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

  it("starts a harness sign-in authorization without contacting the real provider", async () => {
    mocks().loadAtlasSession.mockResolvedValue(null);
    const run = vi.fn();
    mocks().getAuthDatabase.mockReturnValue({ prepare: vi.fn().mockReturnValue({ run }) });
    const { createAtprotoSignInAuthorizationUrl } =
      await import("@/domains/access/server/atproto-oauth");

    const authorizationUrl = await createAtprotoSignInAuthorizationUrl({
      handle: "person.example",
      returnTo: "/account",
      useE2EHarness: true,
    });

    expect(mocks().authorize).not.toHaveBeenCalled();
    expect(authorizationUrl.pathname).toBe("/api/atproto/oauth/harness/authorize");
    expect(authorizationUrl.searchParams.get("handle")).toBe("person.example");
    expect(String(run.mock.calls.at(-1)?.[1])).toContain('"e2eHarness":true');
  });

  it("refuses to build a harness callback URL without both state and handle", async () => {
    const { createAtprotoHarnessProviderCallbackUrl } =
      await import("@/domains/access/server/atproto-oauth");

    for (const query of ["state=state_1", "handle=org.example", ""]) {
      expect(() => createAtprotoHarnessProviderCallbackUrl(new URLSearchParams(query))).toThrow(
        "ATProto provider harness needs state and handle.",
      );
    }
  });

  it("falls back to the public origin when no separate API base URL is configured", async () => {
    vi.stubEnv("ATLAS_ATPROTO_OAUTH_E2E_HARNESS", "1");
    mocks().getAuthRuntimeConfig.mockReturnValue({
      apiBaseUrl: null,
      internalSecret: "secret",
      publicBaseUrl: "https://atlas.test",
    });
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

    await completeAtprotoAuthorization(
      new URLSearchParams("code=atlas-e2e-harness&state=state_1&handle=org.example"),
    );

    expect(String(mocks().fetch.mock.calls[0]?.[0])).toBe(
      "https://atlas.test/api/atproto/identities",
    );
  });

  it("reuses one OAuth client across callbacks and allows a non-local http deployment", async () => {
    mocks().getAuthRuntimeConfig.mockReturnValue({
      apiBaseUrl: "https://api.atlas.test",
      internalSecret: "secret",
      publicBaseUrl: "http://atlas.internal",
    });
    mocks().getAuthDatabase.mockReturnValue({
      prepare: vi.fn().mockReturnValue({ get: vi.fn(), run: vi.fn() }),
    });
    mocks().callback.mockResolvedValue({
      session: { did: "did:plc:person", getTokenInfo: mocks().getTokenInfo },
    });
    const { NodeOAuthClient } = await import("@atproto/oauth-client-node");
    const { completeAtprotoSignIn } = await import("@/domains/access/server/atproto-oauth");

    await expect(completeAtprotoSignIn(new URLSearchParams("code=abc"))).rejects.toThrow(
      "ATProto sign-in is unavailable.",
    );
    await expect(completeAtprotoSignIn(new URLSearchParams("code=abc"))).rejects.toThrow(
      "ATProto sign-in is unavailable.",
    );

    expect(vi.mocked(NodeOAuthClient)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(NodeOAuthClient).mock.calls[0]?.[0]?.allowHttp).toBe(false);
  });
});
