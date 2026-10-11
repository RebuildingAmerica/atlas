import { betterAuth } from "better-auth";
import { PostgresDialect, type PostgresPool } from "kysely";
import { describe, expect, it, vi } from "vitest";

describe("PostgreSQL authentication cooldown", () => {
  it.each(["number", "string", "bigint"] as const)(
    "returns a usable retry delay for a %s database timestamp",
    async (representation) => {
      const now = Date.now();
      const lastRequest =
        representation === "number" ? now : representation === "bigint" ? BigInt(now) : String(now);
      const query = vi.fn().mockImplementation((sql: string) => {
        const updating = sql.startsWith("update");
        return Promise.resolve({
          command: updating ? "UPDATE" : "SELECT",
          rowCount: updating ? 0 : 1,
          rows: updating ? [] : [{ id: "test", key: "test", count: 100, lastRequest }],
        });
      });
      const pool: PostgresPool = {
        options: {},
        connect: vi.fn().mockResolvedValue({ query, release: vi.fn() }),
        end: vi.fn().mockResolvedValue(undefined),
      };
      const auth = betterAuth({
        baseURL: "https://atlas.test",
        secret: "atlas-rate-limit-regression-test-secret-1234567890",
        database: { dialect: new PostgresDialect({ pool }), type: "postgres" },
        rateLimit: { enabled: true, storage: "database", window: 10, max: 100 },
        logger: { disabled: true },
      });
      const response = await auth.handler(
        new Request("https://atlas.test/api/auth/ok", {
          headers: { "x-forwarded-for": "203.0.113.1" },
        }),
      );
      expect(response.status).toBe(429);
      const retryAfter = Number(response.headers.get("x-retry-after"));
      expect(retryAfter).toBeGreaterThanOrEqual(1);
      expect(retryAfter).toBeLessThanOrEqual(10);
    },
  );
});
