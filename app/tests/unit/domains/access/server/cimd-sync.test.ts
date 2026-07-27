import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start/server-only", () => ({}));

import { upsertCimdClientPg, upsertCimdClientSqlite } from "@/domains/access/server/cimd-sync";
import {
  createOAuthClientDatabase,
  readOAuthClientRow,
} from "@/../tests/helpers/access/oauth-client-table";

describe("upsertCimdClientSqlite", () => {
  let database: Database.Database;

  beforeEach(() => {
    database = createOAuthClientDatabase();
  });

  afterEach(() => {
    database.close();
  });

  it("materializes a public PKCE-only client the consent page can render", () => {
    upsertCimdClientSqlite(database, {
      client_id: "https://app.example.com/oauth/client.json",
      client_name: "Example MCP Client",
      client_uri: "https://app.example.com",
      logo_uri: "https://app.example.com/logo.png",
      policy_uri: "https://app.example.com/privacy",
      redirect_uris: ["https://app.example.com/callback"],
      tos_uri: "https://app.example.com/terms",
    });

    expect(readOAuthClientRow(database, "https://app.example.com/oauth/client.json")).toMatchObject(
      {
        clientId: "https://app.example.com/oauth/client.json",
        disabled: 0,
        grantTypes: JSON.stringify(["authorization_code", "refresh_token"]),
        icon: "https://app.example.com/logo.png",
        name: "Example MCP Client",
        policy: "https://app.example.com/privacy",
        public: 1,
        redirectUris: JSON.stringify(["https://app.example.com/callback"]),
        requirePKCE: 1,
        responseTypes: JSON.stringify(["code"]),
        tokenEndpointAuthMethod: "none",
        tos: "https://app.example.com/terms",
        uri: "https://app.example.com",
      },
    );
  });

  it("stores absent optional metadata as null rather than as empty strings", () => {
    upsertCimdClientSqlite(database, {
      client_id: "https://app.example.com/oauth/client.json",
      client_name: "Bare Client",
      redirect_uris: ["https://app.example.com/callback"],
    });

    expect(readOAuthClientRow(database, "https://app.example.com/oauth/client.json")).toMatchObject(
      {
        icon: null,
        policy: null,
        tos: null,
        uri: null,
      },
    );
  });

  it("preserves the document's own grant and response types when it declares them", () => {
    upsertCimdClientSqlite(database, {
      client_id: "https://app.example.com/oauth/client.json",
      client_name: "Code-only Client",
      grant_types: ["authorization_code"],
      redirect_uris: ["https://app.example.com/callback"],
      response_types: ["code", "id_token"],
    });

    const row = readOAuthClientRow(database, "https://app.example.com/oauth/client.json");
    expect(row?.grantTypes).toBe(JSON.stringify(["authorization_code"]));
    expect(row?.responseTypes).toBe(JSON.stringify(["code", "id_token"]));
  });

  it("republishes a changed redirect_uri onto the same row without a re-registration", () => {
    upsertCimdClientSqlite(database, {
      client_id: "https://app.example.com/oauth/client.json",
      client_name: "Example MCP Client",
      redirect_uris: ["https://app.example.com/callback"],
    });
    const first = readOAuthClientRow(database, "https://app.example.com/oauth/client.json");

    upsertCimdClientSqlite(database, {
      client_id: "https://app.example.com/oauth/client.json",
      client_name: "Example MCP Client (renamed)",
      redirect_uris: ["https://app.example.com/callback", "http://127.0.0.1:9000/callback"],
    });

    const second = readOAuthClientRow(database, "https://app.example.com/oauth/client.json");
    expect(second?.id).toBe(first?.id);
    expect(second?.name).toBe("Example MCP Client (renamed)");
    expect(second?.redirectUris).toBe(
      JSON.stringify(["https://app.example.com/callback", "http://127.0.0.1:9000/callback"]),
    );
    expect(second?.createdAt).toBe(first?.createdAt);
    expect(
      database.prepare('SELECT COUNT(*) AS total FROM "oauthClient"').get() as { total: number },
    ).toEqual({ total: 1 });
  });

  it("restores the PKCE-only public posture if the stored row was tampered with", () => {
    upsertCimdClientSqlite(database, {
      client_id: "https://app.example.com/oauth/client.json",
      client_name: "Example MCP Client",
      redirect_uris: ["https://app.example.com/callback"],
    });
    database
      .prepare(
        `UPDATE "oauthClient"
         SET "disabled" = 1, "public" = 0, "requirePKCE" = 0,
             "tokenEndpointAuthMethod" = 'client_secret_basic'`,
      )
      .run();

    upsertCimdClientSqlite(database, {
      client_id: "https://app.example.com/oauth/client.json",
      client_name: "Example MCP Client",
      redirect_uris: ["https://app.example.com/callback"],
    });

    expect(readOAuthClientRow(database, "https://app.example.com/oauth/client.json")).toMatchObject(
      {
        disabled: 0,
        public: 1,
        requirePKCE: 1,
        tokenEndpointAuthMethod: "none",
      },
    );
  });

  it("derives the row id from the client_id so distinct documents never collide", () => {
    upsertCimdClientSqlite(database, {
      client_id: "https://app.example.com/oauth/client.json",
      client_name: "One",
      redirect_uris: ["https://app.example.com/callback"],
    });
    upsertCimdClientSqlite(database, {
      client_id: "https://other.example.com/oauth/client.json",
      client_name: "Two",
      redirect_uris: ["https://other.example.com/callback"],
    });

    const ids = (
      database.prepare('SELECT "id" FROM "oauthClient" ORDER BY "name"').all() as { id: string }[]
    ).map((row) => row.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids.every((id) => id.startsWith("cimd_"))).toBe(true);
  });
});

describe("upsertCimdClientPg", () => {
  /** What the stubbed pool answers a write with. */
  interface PoolQueryResult {
    rowCount: number;
    rows: unknown[];
  }

  /** The parameterized statement the PostgreSQL upsert issues. */
  type PoolQuery = (sql: string, values: unknown[]) => Promise<PoolQueryResult>;

  it("writes the same public PKCE-only row through the pool", async () => {
    const query = vi.fn<PoolQuery>().mockResolvedValue({ rowCount: 1, rows: [] });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-26T12:00:00.000Z"));

    await upsertCimdClientPg({ query } as unknown as Parameters<typeof upsertCimdClientPg>[0], {
      client_id: "https://app.example.com/oauth/client.json",
      client_name: "Example MCP Client",
      client_uri: "https://app.example.com",
      redirect_uris: ["https://app.example.com/callback"],
    });

    const [sql, values] = query.mock.calls[0] ?? [];
    expect(sql).toMatch(/ON CONFLICT \("clientId"\) DO UPDATE SET/);
    expect(values).toEqual([
      `cimd_${Buffer.from("https://app.example.com/oauth/client.json").toString("base64url")}`,
      "https://app.example.com/oauth/client.json",
      "Example MCP Client",
      "https://app.example.com",
      null,
      null,
      null,
      JSON.stringify(["https://app.example.com/callback"]),
      JSON.stringify(["authorization_code", "refresh_token"]),
      JSON.stringify(["code"]),
      new Date("2026-07-26T12:00:00.000Z"),
      new Date("2026-07-26T12:00:00.000Z"),
    ]);

    vi.useRealTimers();
  });

  it("surfaces a failed write instead of reporting a successful registration", async () => {
    const query = vi.fn<PoolQuery>().mockRejectedValue(new Error("connection terminated"));

    await expect(
      upsertCimdClientPg({ query } as unknown as Parameters<typeof upsertCimdClientPg>[0], {
        client_id: "https://app.example.com/oauth/client.json",
        client_name: "Example MCP Client",
        redirect_uris: ["https://app.example.com/callback"],
      }),
    ).rejects.toThrow("connection terminated");
  });
});
