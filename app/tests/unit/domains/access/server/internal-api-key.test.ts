import { beforeEach, describe, expect, it, vi } from "vitest";
import { introspectApiKeyRequest } from "@/domains/access/server/internal-api-key";

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

describe("introspect-api-key", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.ensureAuthReady.mockReset();
    mocks.getAuthRuntimeConfig.mockReset();
    mocks.getAuthRuntimeConfig.mockReturnValue({
      internalSecret: "internal-test-secret",
    });
  });

  it("verifies the internal secret and returns 401 on mismatch", async () => {
    const request = new Request("http://localhost/api/auth/internal/api-key", {
      headers: {
        "x-atlas-internal-secret": "wrong-secret",
      },
    });

    const response = await introspectApiKeyRequest(request);

    expect(response.status).toBe(401);
    const body = (await response.json()) as { valid: boolean };
    expect(body.valid).toBe(false);
  });

  it("verifies the API key and returns its metadata on success", async () => {
    const verifyApiKeyMock = vi.fn().mockResolvedValue({
      valid: true,
      key: {
        id: "key_123",
        name: "Test Key",
        permissions: { discovery: ["read"] },
        referenceId: "user_123",
        metadata: { userEmail: "operator@atlas.test" },
      },
    });

    mocks.ensureAuthReady.mockResolvedValue({
      api: {
        verifyApiKey: verifyApiKeyMock,
      },
    });

    const request = new Request("http://localhost/api/auth/internal/api-key", {
      headers: {
        "x-atlas-internal-secret": "internal-test-secret",
        "x-api-key": "atlas_test_key",
      },
    });

    const response = await introspectApiKeyRequest(request);

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({
      keyId: "key_123",
      name: "Test Key",
      organizationId: undefined,
      permissions: { discovery: ["read"] },
      scopes: ["discovery:read"],
      userEmail: "operator@atlas.test",
      userId: "user_123",
      valid: true,
    });

    expect(verifyApiKeyMock).toHaveBeenCalledWith({
      body: { key: "atlas_test_key" },
    });
  });

  it("returns 401 when the API key is invalid", async () => {
    const verifyApiKeyMock = vi.fn().mockResolvedValue({
      valid: false,
    });

    mocks.ensureAuthReady.mockResolvedValue({
      api: {
        verifyApiKey: verifyApiKeyMock,
      },
    });

    const request = new Request("http://localhost/api/auth/internal/api-key", {
      headers: {
        "x-atlas-internal-secret": "internal-test-secret",
        "x-api-key": "invalid_key",
      },
    });

    const response = await introspectApiKeyRequest(request);

    expect(response.status).toBe(401);
    const body = (await response.json()) as { valid: boolean };
    expect(body.valid).toBe(false);
  });

  it("returns 400 when x-api-key header is missing", async () => {
    const request = new Request("http://localhost/api/auth/internal/api-key", {
      headers: {
        "x-atlas-internal-secret": "internal-test-secret",
      },
    });

    const response = await introspectApiKeyRequest(request);

    expect(response.status).toBe(400);
    const body = (await response.json()) as { valid: boolean };
    expect(body.valid).toBe(false);
  });

  it("logs and rethrows when verifyApiKey fails", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.ensureAuthReady.mockResolvedValue({
      api: {
        verifyApiKey: vi.fn().mockRejectedValue(new Error("db down")),
      },
    });

    const request = new Request("http://localhost/api/auth/internal/api-key", {
      headers: {
        "x-atlas-internal-secret": "internal-test-secret",
        "x-api-key": "some_key",
      },
    });

    await expect(introspectApiKeyRequest(request)).rejects.toThrow("db down");
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("introspection failed"),
      expect.any(Error),
    );
    consoleSpy.mockRestore();
  });

  it("includes organizationId and userEmail from metadata when present", async () => {
    mocks.ensureAuthReady.mockResolvedValue({
      api: {
        verifyApiKey: vi.fn().mockResolvedValue({
          valid: true,
          key: {
            id: "key_1",
            permissions: {},
            referenceId: "user_1",
            metadata: {
              organizationId: "org_1",
              userEmail: "user@atlas.test",
            },
          },
        }),
      },
    });

    const request = new Request("http://localhost/api/auth/internal/api-key", {
      headers: {
        "x-atlas-internal-secret": "internal-test-secret",
        "x-api-key": "some_key",
      },
    });

    const response = await introspectApiKeyRequest(request);
    const body = (await response.json()) as { organizationId: string; userEmail: string };

    expect(body.organizationId).toBe("org_1");
    expect(body.userEmail).toBe("user@atlas.test");
  });
});
