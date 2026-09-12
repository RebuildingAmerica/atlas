import { vi } from "vitest";

const atprotoOAuthMocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  callback: vi.fn(),
  fetch: vi.fn(),
  getAuthDatabase: vi.fn(),
  getAuthPgPool: vi.fn(),
  getAuthRuntimeConfig: vi.fn(),
  getProfile: vi.fn(),
  getTokenInfo: vi.fn(),
  loadAtlasSession: vi.fn(),
  resolveIdentity: vi.fn(),
}));

export function getAtprotoOAuthMocks() {
  return atprotoOAuthMocks;
}

vi.mock("@/domains/access/server/auth", () => ({
  getAuthDatabase: atprotoOAuthMocks.getAuthDatabase,
  getAuthPgPool: atprotoOAuthMocks.getAuthPgPool,
}));

vi.mock("@/domains/access/server/runtime", () => ({
  getAuthRuntimeConfig: atprotoOAuthMocks.getAuthRuntimeConfig,
}));

vi.mock("@/domains/access/server/session-state", () => ({
  loadAtlasSession: atprotoOAuthMocks.loadAtlasSession,
}));

vi.mock("@atproto/oauth-client-node", () => ({
  NodeOAuthClient: vi.fn(function NodeOAuthClient() {
    return {
      authorize: atprotoOAuthMocks.authorize,
      callback: atprotoOAuthMocks.callback,
    };
  }),
}));

vi.mock("@atproto/api", () => ({
  Agent: vi.fn(function Agent() {
    return {
      getProfile: atprotoOAuthMocks.getProfile,
      com: {
        atproto: {
          identity: {
            resolveIdentity: atprotoOAuthMocks.resolveIdentity,
          },
        },
      },
    };
  }),
}));

export function setupAtprotoOAuthMocks(): void {
  vi.unstubAllEnvs();
  vi.resetModules();
  atprotoOAuthMocks.authorize.mockReset();
  atprotoOAuthMocks.callback.mockReset();
  atprotoOAuthMocks.fetch.mockReset();
  atprotoOAuthMocks.getAuthDatabase.mockReset();
  atprotoOAuthMocks.getAuthPgPool.mockReset();
  atprotoOAuthMocks.getAuthRuntimeConfig.mockReset();
  atprotoOAuthMocks.getProfile.mockReset();
  atprotoOAuthMocks.getTokenInfo.mockReset();
  atprotoOAuthMocks.loadAtlasSession.mockReset();
  atprotoOAuthMocks.resolveIdentity.mockReset();

  atprotoOAuthMocks.getAuthRuntimeConfig.mockReturnValue({
    apiBaseUrl: "https://api.atlas.test",
    internalSecret: "secret",
    publicBaseUrl: "https://atlas.test",
  });
  atprotoOAuthMocks.getAuthPgPool.mockReturnValue(null);
  atprotoOAuthMocks.loadAtlasSession.mockResolvedValue({
    user: { email: "operator@atlas.test", id: "user_1" },
    workspace: {},
  });
  atprotoOAuthMocks.authorize.mockResolvedValue(new URL("https://bsky.social/oauth/authorize"));
  vi.stubGlobal("fetch", atprotoOAuthMocks.fetch);
}

/**
 * Arrange a harness callback that returns one already-linked identity.
 *
 * The harness stands in for the external ATProto provider, so a test using it
 * exercises the callback path without a network call.
 */
export function configureHarnessCallback(returnTo: string, responseStatus = 201): void {
  vi.stubEnv("ATLAS_ATPROTO_OAUTH_E2E_HARNESS", "1");
  const get = vi.fn().mockReturnValue({
    value: JSON.stringify({
      requestedHandle: "org.example",
      returnTo,
      userId: "user_1",
    }),
  });
  atprotoOAuthMocks.getAuthDatabase.mockReturnValue({
    prepare: vi.fn().mockReturnValue({ get, run: vi.fn() }),
  });
  atprotoOAuthMocks.fetch.mockResolvedValue(
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
