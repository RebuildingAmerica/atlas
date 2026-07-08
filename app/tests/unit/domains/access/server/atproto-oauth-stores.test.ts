import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthDatabase: vi.fn(),
  getAuthPgPool: vi.fn(),
}));

vi.mock("@/domains/access/server/auth", () => ({
  getAuthDatabase: mocks.getAuthDatabase,
  getAuthPgPool: mocks.getAuthPgPool,
}));

describe("atproto-oauth-stores", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.getAuthDatabase.mockReset();
    mocks.getAuthPgPool.mockReset();
    mocks.getAuthPgPool.mockReturnValue(null);
  });

  it("prunes every ATProto OAuth store on demand", async () => {
    const run = vi.fn();
    const prepare = vi.fn().mockReturnValue({ run });
    mocks.getAuthDatabase.mockReturnValue({ prepare });
    const { pruneAtprotoOAuthStores } =
      await import("@/domains/access/server/atproto-oauth-stores");

    await pruneAtprotoOAuthStores();

    expect(prepare).toHaveBeenCalledWith("DELETE FROM atproto_oauth_state WHERE updated_at < ?");
    expect(prepare).toHaveBeenCalledWith("DELETE FROM atproto_oauth_session WHERE updated_at < ?");
    expect(prepare).toHaveBeenCalledWith(
      "DELETE FROM atproto_oauth_app_state WHERE updated_at < ?",
    );
  });

  it("stores and reads OAuth app state as JSON", async () => {
    const storedRows = new Map<string, string>();
    const run = vi.fn((key: string, value?: string) => {
      if (typeof value === "string") {
        storedRows.set(key, value);
        return;
      }
      storedRows.delete(key);
    });
    const get = vi.fn((key: string) => {
      const value = storedRows.get(key);
      return value ? { value } : undefined;
    });
    const prepare = vi.fn((sql: string) => {
      if (sql.startsWith("SELECT")) return { get };
      return { run };
    });
    mocks.getAuthDatabase.mockReturnValue({ prepare });
    const { createAtprotoOAuthStores } =
      await import("@/domains/access/server/atproto-oauth-stores");

    const { appStateStore } = createAtprotoOAuthStores();
    await appStateStore.set("state_1", {
      requestedHandle: "org.example",
      returnTo: "/claim/org",
      userId: "user_1",
    });

    await expect(appStateStore.get("state_1")).resolves.toEqual({
      requestedHandle: "org.example",
      returnTo: "/claim/org",
      userId: "user_1",
    });
    expect(prepare).toHaveBeenCalledWith(
      "DELETE FROM atproto_oauth_app_state WHERE updated_at < ?",
    );
    expect(run).toHaveBeenCalledWith("state_1", expect.stringContaining("org.example"));
  });
});
