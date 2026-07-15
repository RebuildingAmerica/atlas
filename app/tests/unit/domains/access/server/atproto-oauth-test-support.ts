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
