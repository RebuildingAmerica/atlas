import type Database from "better-sqlite3";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  getAuthDatabase: vi.fn<() => Database.Database | null>(),
  getAuthPgPool: vi.fn<() => unknown>(),
}));

vi.mock("@tanstack/react-start/server-only", () => ({}));
vi.mock("@/domains/access/server/auth", () => authMocks);

import { handleCimdRequest } from "@/domains/access/server/cimd-handler";
import {
  createOAuthClientDatabase,
  readOAuthClientRow,
} from "@/../tests/helpers/access/oauth-client-table";
import {
  VALID_CLIENT_ID_METADATA_CLIENT_ID as CLIENT_ID,
  VALID_CLIENT_ID_METADATA_DOCUMENT,
  jsonResponse,
} from "@/../tests/helpers/access/client-id-metadata-fixtures";

describe("handleCimdRequest", () => {
  let database: Database.Database;

  beforeEach(() => {
    database = createOAuthClientDatabase();
    authMocks.getAuthPgPool.mockReturnValue(null);
    authMocks.getAuthDatabase.mockReturnValue(database);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation(() => Promise.resolve(jsonResponse(VALID_CLIENT_ID_METADATA_DOCUMENT))),
    );
  });

  afterEach(() => {
    database.close();
  });

  it("registers the document's client before Better Auth looks it up", async () => {
    const outcome = await handleCimdRequest(
      new Request(
        `https://atlas.test/api/auth/oauth2/authorize?client_id=${encodeURIComponent(CLIENT_ID)}&response_type=code`,
      ),
    );

    expect(outcome.errorResponse).toBeNull();
    expect(readOAuthClientRow(database, CLIENT_ID)).toMatchObject({
      name: "Example MCP Client",
      public: 1,
      redirectUris: JSON.stringify(VALID_CLIENT_ID_METADATA_DOCUMENT.redirect_uris),
      requirePKCE: 1,
    });
  });

  it("hands the downstream handler a form body it can still read", async () => {
    const body = new URLSearchParams({
      client_id: CLIENT_ID,
      code: "code_123",
      grant_type: "authorization_code",
    }).toString();

    const outcome = await handleCimdRequest(
      new Request("https://atlas.test/api/auth/oauth2/token", {
        body,
        headers: { "content-type": "application/x-www-form-urlencoded" },
        method: "POST",
      }),
    );

    expect(outcome.errorResponse).toBeNull();
    await expect(outcome.request.text()).resolves.toBe(body);
    expect(outcome.request.method).toBe("POST");
    expect(readOAuthClientRow(database, CLIENT_ID)?.clientId).toBe(CLIENT_ID);
  });

  it("reads the client_id out of a JSON registration body", async () => {
    const outcome = await handleCimdRequest(
      new Request("https://atlas.test/api/auth/oauth2/par", {
        body: JSON.stringify({ client_id: CLIENT_ID, response_type: "code" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );

    expect(outcome.errorResponse).toBeNull();
    expect(readOAuthClientRow(database, CLIENT_ID)?.clientId).toBe(CLIENT_ID);
  });

  it("leaves malformed JSON bodies to Better Auth's own validation", async () => {
    const outcome = await handleCimdRequest(
      new Request("https://atlas.test/api/auth/oauth2/par", {
        body: "{not json",
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );

    expect(outcome.errorResponse).toBeNull();
    expect(readOAuthClientRow(database, CLIENT_ID)).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("ignores a JSON body whose client_id is not a string", async () => {
    const outcome = await handleCimdRequest(
      new Request("https://atlas.test/api/auth/oauth2/par", {
        body: JSON.stringify({ client_id: 42 }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );

    expect(outcome.errorResponse).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("ignores bodies in content types the OAuth endpoints do not accept", async () => {
    const outcome = await handleCimdRequest(
      new Request("https://atlas.test/api/auth/oauth2/token", {
        body: `client_id=${CLIENT_ID}`,
        headers: { "content-type": "text/plain" },
        method: "POST",
      }),
    );

    expect(outcome.errorResponse).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("passes a bodyless POST straight through", async () => {
    const outcome = await handleCimdRequest(
      new Request("https://atlas.test/api/auth/oauth2/token", { method: "POST" }),
    );

    expect(outcome.errorResponse).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("passes a form body that names no client through", async () => {
    const outcome = await handleCimdRequest(
      new Request("https://atlas.test/api/auth/oauth2/token", {
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: "rt" }).toString(),
        headers: { "content-type": "application/x-www-form-urlencoded" },
        method: "POST",
      }),
    );

    expect(outcome.errorResponse).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not intercept routes outside the OAuth client-registration path", async () => {
    const request = new Request(
      `https://atlas.test/api/auth/sign-in?client_id=${encodeURIComponent(CLIENT_ID)}`,
    );

    const outcome = await handleCimdRequest(request);

    expect(outcome).toEqual({ errorResponse: null, request });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("leaves opaque Better Auth client ids on the conventional lookup path", async () => {
    const outcome = await handleCimdRequest(
      new Request("https://atlas.test/api/auth/oauth2/authorize?client_id=abc123"),
    );

    expect(outcome.errorResponse).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("passes through an authorize request that carries no client_id at all", async () => {
    const outcome = await handleCimdRequest(
      new Request("https://atlas.test/api/auth/oauth2/authorize"),
    );

    expect(outcome.errorResponse).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports an unreachable metadata document as a bad gateway", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    const outcome = await handleCimdRequest(
      new Request(
        `https://atlas.test/api/auth/oauth2/authorize?client_id=${encodeURIComponent(CLIENT_ID)}`,
      ),
    );

    expect(outcome.errorResponse?.status).toBe(502);
    expect(outcome.errorResponse?.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    await expect(outcome.errorResponse?.json()).resolves.toEqual({
      error: "invalid_client",
      error_description: "CIMD fetch failed: ECONNREFUSED",
    });
  });

  it("reports a client_id that does not match the document as a bad request", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ ...VALID_CLIENT_ID_METADATA_DOCUMENT, client_id: "https://evil.test/c" }),
        ),
    );

    const outcome = await handleCimdRequest(
      new Request(
        `https://atlas.test/api/auth/oauth2/authorize?client_id=${encodeURIComponent(CLIENT_ID)}`,
      ),
    );

    expect(outcome.errorResponse?.status).toBe(400);
    expect(readOAuthClientRow(database, CLIENT_ID)).toBeUndefined();
  });

  it("does not disguise an unexpected resolver failure as an OAuth client error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(new Uint8Array([0xff, 0xfe, 0xfd]), { status: 200 })),
    );

    await expect(
      handleCimdRequest(
        new Request(
          `https://atlas.test/api/auth/oauth2/authorize?client_id=${encodeURIComponent(CLIENT_ID)}`,
        ),
      ),
    ).rejects.toBeInstanceOf(TypeError);
  });

  it("writes through the pool when the deployment is Postgres-backed", async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    authMocks.getAuthPgPool.mockReturnValue({ query });
    authMocks.getAuthDatabase.mockReturnValue(null);

    const outcome = await handleCimdRequest(
      new Request(
        `https://atlas.test/api/auth/oauth2/public-client?client_id=${encodeURIComponent(CLIENT_ID)}`,
      ),
    );

    expect(outcome.errorResponse).toBeNull();
    expect(query.mock.calls[0]?.[1]).toEqual(
      expect.arrayContaining([CLIENT_ID, "Example MCP Client"]),
    );
  });

  it("refuses to silently skip registration when no auth database is configured", async () => {
    authMocks.getAuthPgPool.mockReturnValue(null);
    authMocks.getAuthDatabase.mockReturnValue(null);

    await expect(
      handleCimdRequest(
        new Request(
          `https://atlas.test/api/auth/oauth2/public-client-prelogin?client_id=${encodeURIComponent(CLIENT_ID)}`,
        ),
      ),
    ).rejects.toThrow("CIMD upsert: neither Postgres pool nor SQLite database is available.");
  });

  it("honours a caller-supplied host allowlist", async () => {
    const outcome = await handleCimdRequest(
      new Request(
        `https://atlas.test/api/auth/oauth2/authorize?client_id=${encodeURIComponent(CLIENT_ID)}`,
      ),
      { allowedHostSuffixes: ["trusted.example"], maxBytes: 10_240, timeoutMs: 5_000 },
    );

    expect(outcome.errorResponse?.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
});
