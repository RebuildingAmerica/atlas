import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface MockSqliteStatement {
  get: ReturnType<typeof vi.fn>;
}

interface MockSqliteDatabase {
  prepare: ReturnType<typeof vi.fn>;
}

const mocks = vi.hoisted(() => ({
  getAuthDatabase: vi.fn(),
  getAuthPgPool: vi.fn(),
  getAuthRuntimeConfig: vi.fn(),
  loadAtlasSession: vi.fn(),
}));

vi.mock("@/domains/access/server/auth", () => ({
  getAuthDatabase: mocks.getAuthDatabase,
  getAuthPgPool: mocks.getAuthPgPool,
}));

vi.mock("@/domains/access/server/runtime", () => ({
  getAuthRuntimeConfig: mocks.getAuthRuntimeConfig,
}));

vi.mock("@/domains/access/server/session-state", () => ({
  loadAtlasSession: mocks.loadAtlasSession,
}));

function buildSqliteDatabaseReturning(row: unknown): MockSqliteDatabase {
  const statement: MockSqliteStatement = {
    get: vi.fn().mockReturnValue(row),
  };
  return { prepare: vi.fn().mockReturnValue(statement) };
}

describe("loadOidcRpLogoutRedirect", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    mocks.getAuthRuntimeConfig.mockReturnValue({
      publicBaseUrl: "https://atlas.test",
    });
    mocks.getAuthPgPool.mockReturnValue(null);
    mocks.loadAtlasSession.mockResolvedValue({
      user: { id: "user_123", email: "operator@atlas.test", emailVerified: true, name: "Op" },
      session: { id: "session_123" },
      hasPasskey: true,
      passkeyCount: 1,
      accountReady: true,
      workspace: null,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it("returns null when there is no active session", async () => {
    mocks.loadAtlasSession.mockResolvedValue(null);
    mocks.getAuthDatabase.mockReturnValue(null);

    const { loadOidcRpLogoutRedirect } = await import("@/domains/access/server/rp-logout");

    expect(await loadOidcRpLogoutRedirect()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null when no linked account holds an idToken", async () => {
    mocks.getAuthDatabase.mockReturnValue(buildSqliteDatabaseReturning(undefined));

    const { loadOidcRpLogoutRedirect } = await import("@/domains/access/server/rp-logout");

    expect(await loadOidcRpLogoutRedirect()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null when the IdP discovery doc has no end_session_endpoint", async () => {
    mocks.getAuthDatabase.mockReturnValue(
      buildSqliteDatabaseReturning({
        idToken: "id-token-abc",
        providerId: "atlas-team-google-workspace-oidc",
        issuer: "https://accounts.google.com",
      }),
    );
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });

    const { loadOidcRpLogoutRedirect } = await import("@/domains/access/server/rp-logout");

    expect(await loadOidcRpLogoutRedirect()).toBeNull();
  });

  it("builds the RP-Initiated Logout URL when the IdP advertises end_session_endpoint", async () => {
    mocks.getAuthDatabase.mockReturnValue(
      buildSqliteDatabaseReturning({
        idToken: "id-token-abc",
        providerId: "atlas-team-okta-oidc",
        issuer: "https://idp.atlas-test.example",
      }),
    );
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          end_session_endpoint: "https://idp.atlas-test.example/oauth2/v2/logout",
        }),
    });

    const { loadOidcRpLogoutRedirect } = await import("@/domains/access/server/rp-logout");

    const url = await loadOidcRpLogoutRedirect();

    expect(url).not.toBeNull();
    const parsed = new URL(url ?? "");
    expect(parsed.origin + parsed.pathname).toBe("https://idp.atlas-test.example/oauth2/v2/logout");
    expect(parsed.searchParams.get("id_token_hint")).toBe("id-token-abc");
    expect(parsed.searchParams.get("post_logout_redirect_uri")).toBe(
      "https://atlas.test/post-logout",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://idp.atlas-test.example/.well-known/openid-configuration",
      expect.objectContaining({ signal: expect.any(AbortSignal) as AbortSignal }),
    );
  });

  it("returns null when the discovery fetch fails", async () => {
    mocks.getAuthDatabase.mockReturnValue(
      buildSqliteDatabaseReturning({
        idToken: "id-token-abc",
        providerId: "atlas-team-okta-oidc",
        issuer: "https://idp.atlas-test.example",
      }),
    );
    fetchMock.mockRejectedValue(new Error("network down"));

    const { loadOidcRpLogoutRedirect } = await import("@/domains/access/server/rp-logout");

    expect(await loadOidcRpLogoutRedirect()).toBeNull();
  });

  it("refuses to fetch discovery from a non-HTTPS issuer", async () => {
    mocks.getAuthDatabase.mockReturnValue(
      buildSqliteDatabaseReturning({
        idToken: "id-token-abc",
        providerId: "atlas-team-bad-oidc",
        issuer: "http://idp.atlas-test.example",
      }),
    );

    const { loadOidcRpLogoutRedirect } = await import("@/domains/access/server/rp-logout");

    expect(await loadOidcRpLogoutRedirect()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses to fetch discovery from a private-host issuer", async () => {
    mocks.getAuthDatabase.mockReturnValue(
      buildSqliteDatabaseReturning({
        idToken: "id-token-abc",
        providerId: "atlas-team-bad-oidc",
        issuer: "https://169.254.169.254",
      }),
    );

    const { loadOidcRpLogoutRedirect } = await import("@/domains/access/server/rp-logout");

    expect(await loadOidcRpLogoutRedirect()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
