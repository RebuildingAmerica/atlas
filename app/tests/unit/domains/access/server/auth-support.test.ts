import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthDatabase: vi.fn<() => Database.Database | null>(),
  getAuthPgPool: vi.fn<() => unknown>(),
  getCimdResolverOptions: vi.fn(),
}));

vi.mock("@tanstack/react-start/server-only", () => ({}));
vi.mock("@/domains/access/server/auth-db", () => ({
  getAuthDatabase: mocks.getAuthDatabase,
  getAuthPgPool: mocks.getAuthPgPool,
}));
vi.mock("@/domains/access/server/runtime", () => ({
  getCimdResolverOptions: mocks.getCimdResolverOptions,
}));

import {
  buildAtlasTrustedOrigins,
  enforceRequirePkceOnAllClients,
  isRegisteredOAuthDeviceClient,
  normalizeEmail,
} from "@/domains/access/server/auth-support";
import { DEFAULT_CIMD_RESOLVER_OPTIONS } from "@/domains/access/server/client-id-metadata";
import {
  createOAuthClientDatabase,
  readOAuthClientRow,
} from "@/../tests/helpers/access/oauth-client-table";
import {
  VALID_CLIENT_ID_METADATA_CLIENT_ID as CIMD_CLIENT_ID,
  VALID_CLIENT_ID_METADATA_DOCUMENT,
  jsonResponse,
} from "@/../tests/helpers/access/client-id-metadata-fixtures";

describe("normalizeEmail", () => {
  it("folds case and surrounding whitespace so one person is one account", () => {
    expect(normalizeEmail("  Operator@Atlas.TEST ")).toBe("operator@atlas.test");
  });
});

describe("buildAtlasTrustedOrigins", () => {
  it("trusts Atlas itself plus the Google endpoints workspace SSO redirects through", () => {
    expect(buildAtlasTrustedOrigins("https://atlas.test")).toEqual([
      "https://atlas.test",
      "https://accounts.google.com",
      "https://oauth2.googleapis.com",
      "https://openidconnect.googleapis.com",
      "https://www.googleapis.com",
    ]);
  });
});

describe("isRegisteredOAuthDeviceClient", () => {
  let database: Database.Database;

  beforeEach(() => {
    database = createOAuthClientDatabase();
    mocks.getAuthPgPool.mockReturnValue(null);
    mocks.getAuthDatabase.mockReturnValue(database);
    mocks.getCimdResolverOptions.mockReturnValue(DEFAULT_CIMD_RESOLVER_OPTIONS);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(
            jsonResponse({ ...VALID_CLIENT_ID_METADATA_DOCUMENT, client_id: CIMD_CLIENT_ID }),
          ),
        ),
    );
  });

  afterEach(() => {
    database.close();
  });

  it("rejects a blank client id without touching the database", async () => {
    await expect(isRegisteredOAuthDeviceClient("   ")).resolves.toBe(false);
    expect(mocks.getAuthPgPool).not.toHaveBeenCalled();
  });

  it("accepts a registered client and rejects an unknown one", async () => {
    database
      .prepare(
        `INSERT INTO "oauthClient" ("id", "clientId", "redirectUris", "disabled")
         VALUES ('row_1', 'scout-cli', '[]', 0)`,
      )
      .run();

    await expect(isRegisteredOAuthDeviceClient(" scout-cli ")).resolves.toBe(true);
    await expect(isRegisteredOAuthDeviceClient("someone-elses-cli")).resolves.toBe(false);
  });

  it("rejects a client an operator has disabled", async () => {
    database
      .prepare(
        `INSERT INTO "oauthClient" ("id", "clientId", "redirectUris", "disabled")
         VALUES ('row_1', 'scout-cli', '[]', 1)`,
      )
      .run();

    await expect(isRegisteredOAuthDeviceClient("scout-cli")).resolves.toBe(false);
  });

  it("treats a client with no disabled flag as active", async () => {
    database
      .prepare(
        `INSERT INTO "oauthClient" ("id", "clientId", "redirectUris") VALUES ('row_1', 'scout-cli', '[]')`,
      )
      .run();

    await expect(isRegisteredOAuthDeviceClient("scout-cli")).resolves.toBe(true);
  });

  it("registers a CIMD device client on first sight so device login can proceed", async () => {
    await expect(isRegisteredOAuthDeviceClient(CIMD_CLIENT_ID)).resolves.toBe(true);
    expect(readOAuthClientRow(database, CIMD_CLIENT_ID)).toMatchObject({
      name: "Example MCP Client",
      requirePKCE: 1,
    });
  });

  it("declines a CIMD client whose document cannot be resolved", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    await expect(isRegisteredOAuthDeviceClient(CIMD_CLIENT_ID)).resolves.toBe(false);
    expect(readOAuthClientRow(database, CIMD_CLIENT_ID)).toBeUndefined();
  });

  it("does not swallow an unexpected resolver failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(new Uint8Array([0xff, 0xfe]), { status: 200 })),
    );

    await expect(isRegisteredOAuthDeviceClient(CIMD_CLIENT_ID)).rejects.toBeInstanceOf(TypeError);
  });

  it("requires an auth database before it will vouch for a device client", async () => {
    mocks.getAuthDatabase.mockReturnValue(null);

    await expect(isRegisteredOAuthDeviceClient("scout-cli")).rejects.toThrow(
      "OAuth device client validation requires an auth database.",
    );
  });

  it("requires an auth database before it will register a CIMD client", async () => {
    mocks.getAuthDatabase.mockReturnValue(null);

    await expect(isRegisteredOAuthDeviceClient(CIMD_CLIENT_ID)).rejects.toThrow(
      "OAuth device client validation requires an auth database.",
    );
  });

  it("reads the client's state from Postgres when the deployment is pool-backed", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ disabled: false }] });
    mocks.getAuthPgPool.mockReturnValue({ query });
    mocks.getAuthDatabase.mockReturnValue(null);

    await expect(isRegisteredOAuthDeviceClient("scout-cli")).resolves.toBe(true);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('from "oauthClient"'), [
      "scout-cli",
    ]);
  });

  it("rejects a Postgres-stored client that is disabled or absent", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ disabled: true }] })
      .mockResolvedValueOnce({ rows: [] });
    mocks.getAuthPgPool.mockReturnValue({ query });
    mocks.getAuthDatabase.mockReturnValue(null);

    await expect(isRegisteredOAuthDeviceClient("scout-cli")).resolves.toBe(false);
    await expect(isRegisteredOAuthDeviceClient("scout-cli")).resolves.toBe(false);
  });

  it("registers a CIMD client through the pool before looking it up", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ disabled: false }] });
    mocks.getAuthPgPool.mockReturnValue({ query });
    mocks.getAuthDatabase.mockReturnValue(null);

    await expect(isRegisteredOAuthDeviceClient(CIMD_CLIENT_ID)).resolves.toBe(true);
    expect(query.mock.calls[0]?.[0]).toMatch(/INSERT INTO "oauthClient"/);
    expect(query.mock.calls[0]?.[1]).toEqual(
      expect.arrayContaining([CIMD_CLIENT_ID, "Example MCP Client"]),
    );
  });
});

describe("enforceRequirePkceOnAllClients", () => {
  it("upgrades every stored SQLite client to PKCE-required", async () => {
    const database = createOAuthClientDatabase();
    database
      .prepare(
        `INSERT INTO "oauthClient" ("id", "clientId", "redirectUris", "requirePKCE")
         VALUES ('row_1', 'legacy', '[]', 0), ('row_2', 'modern', '[]', 1)`,
      )
      .run();

    await enforceRequirePkceOnAllClients(database, null);

    expect(
      database.prepare('SELECT "clientId", "requirePKCE" FROM "oauthClient" ORDER BY "id"').all(),
    ).toEqual([
      { clientId: "legacy", requirePKCE: 1 },
      { clientId: "modern", requirePKCE: 1 },
    ]);
    database.close();
  });

  it("upgrades Postgres clients through the pool instead of the local file", async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    const database = createOAuthClientDatabase();
    const prepare = vi.spyOn(database, "prepare");

    await enforceRequirePkceOnAllClients(database, {
      query,
    } as unknown as Parameters<typeof enforceRequirePkceOnAllClients>[1]);

    expect(query).toHaveBeenCalledWith(
      'update "oauthClient" set "requirePKCE" = true where "requirePKCE" = false',
    );
    expect(prepare).not.toHaveBeenCalled();
    database.close();
  });
});
