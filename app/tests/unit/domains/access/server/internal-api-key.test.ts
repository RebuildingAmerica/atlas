import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureAuthReady: vi.fn(),
  getAuthRuntimeConfig: vi.fn(),
}));

vi.mock("@/domains/access/server/auth", () => ({
  ensureAuthReady: mocks.ensureAuthReady,
}));

vi.mock("@/domains/access/server/runtime", () => ({
  getAuthRuntimeConfig: mocks.getAuthRuntimeConfig,
}));

describe("introspectApiKeyRequest", () => {
  beforeEach(() => {
    mocks.ensureAuthReady.mockReset();
    mocks.getAuthRuntimeConfig.mockReset();
    mocks.getAuthRuntimeConfig.mockReturnValue({
      internalSecret: "internal-test-secret",
    });
  });

  it("returns 401 when Better Auth reports an invalid API key", async () => {
    mocks.ensureAuthReady.mockResolvedValue({
      api: {
        verifyApiKey: vi.fn().mockResolvedValue({
          error: {
            code: "INVALID_API_KEY",
            message: "Invalid API key.",
          },
          key: null,
          valid: false,
        }),
      },
    });

    const { introspectApiKeyRequest } = await import("@/domains/access/server/internal-api-key");
    const response = await introspectApiKeyRequest(
      new Request("http://atlas.test/api/auth/internal/api-key", {
        headers: {
          "X-Atlas-Internal-Secret": "internal-test-secret",
          "X-API-Key": "atlas_invalid_key",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      valid: false,
    });
  });

  it("returns the normalized Atlas principal payload for valid API keys", async () => {
    mocks.ensureAuthReady.mockResolvedValue({
      api: {
        verifyApiKey: vi.fn().mockResolvedValue({
          error: null,
          key: {
            id: "key_123",
            metadata: {
              userEmail: "operator@atlas.test",
            },
            name: "CLI key",
            permissions: {
              discovery: ["read"],
            },
            referenceId: "user_123",
          },
          valid: true,
        }),
      },
    });

    const { introspectApiKeyRequest } = await import("@/domains/access/server/internal-api-key");
    const response = await introspectApiKeyRequest(
      new Request("http://atlas.test/api/auth/internal/api-key", {
        headers: {
          "X-Atlas-Internal-Secret": "internal-test-secret",
          "X-API-Key": "atlas_valid_key",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      keyId: "key_123",
      name: "CLI key",
      permissions: {
        discovery: ["read"],
      },
      scopes: ["discovery:read"],
      userEmail: "operator@atlas.test",
      userId: "user_123",
      valid: true,
    });
  });

  it("fills in default principal fields when Better Auth omits optional metadata", async () => {
    mocks.ensureAuthReady.mockResolvedValue({
      api: {
        verifyApiKey: vi.fn().mockResolvedValue({
          error: null,
          key: {
            id: "key_456",
            metadata: {},
            name: null,
            permissions: null,
            referenceId: "user_456",
          },
          valid: true,
        }),
      },
    });

    const { introspectApiKeyRequest } = await import("@/domains/access/server/internal-api-key");
    const response = await introspectApiKeyRequest(
      new Request("http://atlas.test/api/auth/internal/api-key", {
        headers: {
          "X-Atlas-Internal-Secret": "internal-test-secret",
          "X-API-Key": "atlas_valid_key",
        },
        method: "POST",
      }),
    );

    await expect(response.json()).resolves.toEqual({
      keyId: "key_456",
      name: "Atlas API Key",
      permissions: {},
      scopes: [],
      userEmail: "",
      userId: "user_456",
      valid: true,
    });
  });
});
