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

describe("internal-api-key additional branches", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.ensureAuthReady.mockReset();
    mocks.getAuthRuntimeConfig.mockReset();
    mocks.getAuthRuntimeConfig.mockReturnValue({
      internalSecret: "internal-test-secret",
    });
  });

  it("returns 401 when the internal secret does not match", async () => {
    const { introspectApiKeyRequest } = await import("@/domains/access/server/internal-api-key");
    const response = await introspectApiKeyRequest(
      new Request("http://atlas.test/api/auth/internal/api-key", {
        headers: {
          "X-Atlas-Internal-Secret": "wrong-secret",
          "X-API-Key": "atlas_valid_key",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      valid: false,
    });
  });

  it("returns 400 when the caller omits the API key header", async () => {
    const { introspectApiKeyRequest } = await import("@/domains/access/server/internal-api-key");
    const response = await introspectApiKeyRequest(
      new Request("http://atlas.test/api/auth/internal/api-key", {
        headers: {
          "X-Atlas-Internal-Secret": "internal-test-secret",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      valid: false,
    });
  });

  it("logs and rethrows unexpected Better Auth verification errors", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {
      /* suppress */
    });

    mocks.ensureAuthReady.mockResolvedValue({
      api: {
        verifyApiKey: vi.fn().mockRejectedValue(new Error("boom")),
      },
    });

    const { introspectApiKeyRequest } = await import("@/domains/access/server/internal-api-key");
    const promise = introspectApiKeyRequest(
      new Request("http://atlas.test/api/auth/internal/api-key", {
        headers: {
          "X-Atlas-Internal-Secret": "internal-test-secret",
          "X-API-Key": "atlas_valid_key",
        },
        method: "POST",
      }),
    );

    await expect(promise).rejects.toThrow("boom");
    expect(errorSpy).toHaveBeenCalledWith("Atlas API key introspection failed.", expect.any(Error));

    errorSpy.mockRestore();
  });
});
