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

  it("owns its OAuth client per Workers request and skips request-time schema creation", async () => {
    vi.stubEnv("ATLAS_AUTH_MIGRATIONS", "external");
    mocks().getAuthPgPool.mockReturnValue({ query: vi.fn().mockResolvedValue({ rows: [] }) });
    const { runWorkerRequest } = await import("../../../../../server/request-scope");
    const { createAtprotoAuthorizationUrl } = await import("@/domains/access/server/atproto-oauth");
    for (const name of ["a", "b"])
      await runWorkerRequest("postgres://" + name, async () => {
        await createAtprotoAuthorizationUrl({ handle: "acme.org", returnTo: "/account#identity" });
        await createAtprotoAuthorizationUrl({ handle: "acme.org", returnTo: "/account#identity" });
        return new Response(null, { status: 204 });
      });
    expect(mocks().authorize).toHaveBeenCalledTimes(4);
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
      }),
    ).resolves.toEqual(new URL("https://bsky.social/oauth/authorize"));

    const insertedPayload = String(run.mock.calls.at(-1)?.[1]);
    expect(insertedPayload).toContain('"flow":"sign-in"');
    expect(insertedPayload).toContain('"requestedHandle":"person.example"');
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
