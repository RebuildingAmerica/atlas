import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  getAuthDatabase: vi.fn<() => Database.Database | null>(),
  getAuthPgPool: vi.fn<() => unknown>(),
}));

vi.mock("@tanstack/react-start/server-only", () => ({}));
vi.mock("@/domains/access/server/auth", () => authMocks);

import {
  ATLAS_MIGRATIONS,
  runAtlasCustomMigrations,
} from "@/domains/access/server/atlas-migrations";
import {
  ScoutDeviceRevokedError,
  listScoutDevicesForUser,
  registerOrTouchScoutDevice,
  revokeScoutDevice,
} from "@/domains/access/server/scout-devices";
import { storedScoutDeviceRow, type ScoutDevicePoolQuery } from "./scout-devices-test-support";

describe("scout-devices", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    runAtlasCustomMigrations(db, ATLAS_MIGRATIONS);
    authMocks.getAuthDatabase.mockReset();
    authMocks.getAuthPgPool.mockReset();
    authMocks.getAuthPgPool.mockReturnValue(null);
    authMocks.getAuthDatabase.mockReturnValue(db);
  });

  afterEach(() => {
    db.close();
  });

  it("enrolls a Scout device and returns it for the owning user", async () => {
    const device = await registerOrTouchScoutDevice({
      defaultUploadTarget: "workspace",
      id: "worker-123",
      now: new Date("2026-07-04T16:00:00.000Z"),
      searchKeyConfigured: true,
      userId: "user-123",
      workerName: "Willie's MacBook Pro",
      workspaceId: "org-123",
    });

    expect(device).toMatchObject({
      defaultUploadTarget: "workspace",
      id: "worker-123",
      searchKeyConfigured: true,
      userId: "user-123",
      workerName: "Willie's MacBook Pro",
      workspaceId: "org-123",
    });

    await registerOrTouchScoutDevice({
      defaultUploadTarget: "public",
      id: "worker-456",
      now: new Date("2026-07-04T16:10:00.000Z"),
      searchKeyConfigured: false,
      userId: "other-user",
      workerName: "Other device",
      workspaceId: null,
    });

    const devices = await listScoutDevicesForUser("user-123");

    expect(devices).toEqual([
      {
        createdAt: "2026-07-04T16:00:00.000Z",
        defaultUploadTarget: "workspace",
        id: "worker-123",
        lastSeenAt: "2026-07-04T16:00:00.000Z",
        revokedAt: null,
        searchKeyConfigured: true,
        userId: "user-123",
        workerName: "Willie's MacBook Pro",
        workspaceId: "org-123",
      },
    ]);
  });

  it("touches existing devices without clearing stored search-key state", async () => {
    await registerOrTouchScoutDevice({
      defaultUploadTarget: "workspace",
      id: "worker-123",
      now: new Date("2026-07-04T16:00:00.000Z"),
      searchKeyConfigured: true,
      userId: "user-123",
      workerName: "Laptop",
      workspaceId: "org-123",
    });

    await registerOrTouchScoutDevice({
      defaultUploadTarget: "public",
      id: "worker-123",
      now: new Date("2026-07-04T17:00:00.000Z"),
      userId: "user-123",
      workerName: "Laptop renamed",
      workspaceId: null,
    });

    expect(await listScoutDevicesForUser("user-123")).toMatchObject([
      {
        defaultUploadTarget: "public",
        lastSeenAt: "2026-07-04T17:00:00.000Z",
        searchKeyConfigured: true,
        workerName: "Laptop renamed",
        workspaceId: null,
      },
    ]);
  });

  it("hides revoked devices and blocks token refresh for the same worker id", async () => {
    await registerOrTouchScoutDevice({
      defaultUploadTarget: "workspace",
      id: "worker-123",
      now: new Date("2026-07-04T16:00:00.000Z"),
      searchKeyConfigured: false,
      userId: "user-123",
      workerName: "Laptop",
      workspaceId: "org-123",
    });

    await revokeScoutDevice({
      deviceId: "worker-123",
      now: new Date("2026-07-04T18:00:00.000Z"),
      userId: "user-123",
    });

    expect(await listScoutDevicesForUser("user-123")).toEqual([]);
    await expect(
      registerOrTouchScoutDevice({
        defaultUploadTarget: "workspace",
        id: "worker-123",
        now: new Date("2026-07-04T18:01:00.000Z"),
        userId: "user-123",
        workerName: "Laptop",
        workspaceId: "org-123",
      }),
    ).rejects.toBeInstanceOf(ScoutDeviceRevokedError);
  });

  it("rejects revocation when no active device is owned by that user", async () => {
    await registerOrTouchScoutDevice({
      defaultUploadTarget: "workspace",
      id: "worker-123",
      now: new Date("2026-07-04T16:00:00.000Z"),
      searchKeyConfigured: false,
      userId: "user-123",
      workerName: "Laptop",
      workspaceId: "org-123",
    });

    await expect(
      revokeScoutDevice({
        deviceId: "worker-123",
        now: new Date("2026-07-04T18:00:00.000Z"),
        userId: "other-user",
      }),
    ).rejects.toThrow("Scout device worker-123 could not be revoked.");

    expect(await listScoutDevicesForUser("user-123")).toHaveLength(1);
  });

  it("rejects missed PostgreSQL revocations", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rowCount: 0, rows: [] });
    authMocks.getAuthPgPool.mockReturnValue({ query });
    authMocks.getAuthDatabase.mockReturnValue(null);

    await expect(
      revokeScoutDevice({
        deviceId: "worker-123",
        now: new Date("2026-07-04T18:00:00.000Z"),
        userId: "user-123",
      }),
    ).rejects.toThrow("Scout device worker-123 could not be revoked.");

    expect(query).toHaveBeenCalledWith(expect.stringMatching(/UPDATE scout_devices/), [
      "2026-07-04T18:00:00.000Z",
      "worker-123",
      "user-123",
    ]);
  });

  it("uses PostgreSQL when the auth runtime is backed by a pool", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            created_at: "2026-07-04T16:00:00.000Z",
            default_upload_target: "workspace",
            id: "worker-123",
            last_seen_at: "2026-07-04T16:00:00.000Z",
            revoked_at: null,
            search_key_configured: true,
            user_id: "user-123",
            worker_name: "Laptop",
            workspace_id: "org-123",
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            created_at: "2026-07-04T16:00:00.000Z",
            default_upload_target: "workspace",
            id: "worker-123",
            last_seen_at: "2026-07-04T16:00:00.000Z",
            revoked_at: null,
            search_key_configured: true,
            user_id: "user-123",
            worker_name: "Laptop",
            workspace_id: "org-123",
          },
        ],
      });
    authMocks.getAuthPgPool.mockReturnValue({ query });
    authMocks.getAuthDatabase.mockReturnValue(null);

    await registerOrTouchScoutDevice({
      defaultUploadTarget: "workspace",
      id: "worker-123",
      now: new Date("2026-07-04T16:00:00.000Z"),
      searchKeyConfigured: true,
      userId: "user-123",
      workerName: "Laptop",
      workspaceId: "org-123",
    });
    const devices = await listScoutDevicesForUser("user-123");

    expect(query.mock.calls[1]?.[0]).toMatch(/INSERT INTO scout_devices/);
    expect(query.mock.calls[1]?.[1]).toEqual([
      "worker-123",
      "user-123",
      "Laptop",
      "workspace",
      "org-123",
      true,
      "2026-07-04T16:00:00.000Z",
    ]);
    expect(devices[0]?.searchKeyConfigured).toBe(true);
  });
});

describe("scout-devices input handling", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runAtlasCustomMigrations(db, ATLAS_MIGRATIONS);
    authMocks.getAuthPgPool.mockReturnValue(null);
    authMocks.getAuthDatabase.mockReturnValue(db);
  });

  afterEach(() => {
    db.close();
  });

  it("mints a device id and stamps the current time when the CLI supplies neither", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-26T12:00:00.000Z"));

    const device = await registerOrTouchScoutDevice({
      defaultUploadTarget: "public",
      userId: "user-123",
      workerName: "Unnamed host",
      workspaceId: null,
    });

    expect(device.id).toMatch(/^scout_[0-9a-f-]{36}$/);
    expect(device.createdAt).toBe("2026-07-26T12:00:00.000Z");
    expect(device.lastSeenAt).toBe("2026-07-26T12:00:00.000Z");
    expect(device.searchKeyConfigured).toBe(false);

    vi.useRealTimers();
  });

  it("treats a blank workspace id as no workspace at all", async () => {
    const device = await registerOrTouchScoutDevice({
      defaultUploadTarget: "public",
      id: "worker-123",
      now: new Date("2026-07-04T16:00:00.000Z"),
      userId: "user-123",
      workerName: "Laptop",
      workspaceId: "   ",
    });

    expect(device.workspaceId).toBeNull();
  });

  it("keeps a device flagged as having no search key when it is touched again", async () => {
    await registerOrTouchScoutDevice({
      defaultUploadTarget: "workspace",
      id: "worker-123",
      now: new Date("2026-07-04T16:00:00.000Z"),
      searchKeyConfigured: false,
      userId: "user-123",
      workerName: "Laptop",
      workspaceId: "org-123",
    });

    await registerOrTouchScoutDevice({
      defaultUploadTarget: "workspace",
      id: "worker-123",
      now: new Date("2026-07-04T17:00:00.000Z"),
      userId: "user-123",
      workerName: "Laptop",
      workspaceId: "org-123",
    });

    expect((await listScoutDevicesForUser("user-123"))[0]?.searchKeyConfigured).toBe(false);
  });

  it("refuses to let one user re-register another user's device id", async () => {
    await registerOrTouchScoutDevice({
      defaultUploadTarget: "workspace",
      id: "worker-123",
      now: new Date("2026-07-04T16:00:00.000Z"),
      userId: "user-123",
      workerName: "Laptop",
      workspaceId: "org-123",
    });

    await expect(
      registerOrTouchScoutDevice({
        defaultUploadTarget: "workspace",
        id: "worker-123",
        now: new Date("2026-07-04T17:00:00.000Z"),
        userId: "attacker",
        workerName: "Laptop",
        workspaceId: "org-123",
      }),
    ).rejects.toThrow("Scout device worker-123 belongs to a different user.");
  });

  it("rejects blank identifiers rather than enrolling an unattributable device", async () => {
    await expect(
      registerOrTouchScoutDevice({
        defaultUploadTarget: "public",
        id: "   ",
        userId: "user-123",
        workerName: "Laptop",
        workspaceId: null,
      }),
    ).rejects.toThrow("Scout device id is required.");

    await expect(
      registerOrTouchScoutDevice({
        defaultUploadTarget: "public",
        userId: "  ",
        workerName: "Laptop",
        workspaceId: null,
      }),
    ).rejects.toThrow("Scout user id is required.");

    await expect(
      registerOrTouchScoutDevice({
        defaultUploadTarget: "public",
        userId: "user-123",
        workerName: "   ",
        workspaceId: null,
      }),
    ).rejects.toThrow("Scout device name is required.");

    await expect(listScoutDevicesForUser("  ")).rejects.toThrow("Scout user id is required.");
    await expect(revokeScoutDevice({ deviceId: " ", userId: "user-123" })).rejects.toThrow(
      "Scout device id is required.",
    );
  });

  it("fails loudly when an enrollment does not land in the table", async () => {
    db.exec(
      `CREATE TRIGGER skip_scout_device_insert BEFORE INSERT ON scout_devices
       BEGIN SELECT RAISE(IGNORE); END`,
    );

    await expect(
      registerOrTouchScoutDevice({
        defaultUploadTarget: "public",
        id: "worker-123",
        userId: "user-123",
        workerName: "Laptop",
        workspaceId: null,
      }),
    ).rejects.toThrow("Scout device insert did not return a stored row.");
  });

  it("fails loudly when a device is deleted out from under a refresh", async () => {
    await registerOrTouchScoutDevice({
      defaultUploadTarget: "public",
      id: "worker-123",
      now: new Date("2026-07-04T16:00:00.000Z"),
      userId: "user-123",
      workerName: "Laptop",
      workspaceId: null,
    });
    db.exec(
      `CREATE TRIGGER drop_scout_device_on_update AFTER UPDATE ON scout_devices
       BEGIN DELETE FROM scout_devices WHERE id = old.id; END`,
    );

    await expect(
      registerOrTouchScoutDevice({
        defaultUploadTarget: "public",
        id: "worker-123",
        now: new Date("2026-07-04T17:00:00.000Z"),
        userId: "user-123",
        workerName: "Laptop",
        workspaceId: null,
      }),
    ).rejects.toThrow("Scout device update did not return a stored row.");
  });

  it("stamps the revocation with the current clock when none is supplied", async () => {
    await registerOrTouchScoutDevice({
      defaultUploadTarget: "public",
      id: "worker-123",
      now: new Date("2026-07-04T16:00:00.000Z"),
      userId: "user-123",
      workerName: "Laptop",
      workspaceId: null,
    });

    await revokeScoutDevice({ deviceId: "worker-123", userId: "user-123" });

    expect(await listScoutDevicesForUser("user-123")).toEqual([]);
  });
});

describe("scout-devices on PostgreSQL", () => {
  beforeEach(() => {
    authMocks.getAuthDatabase.mockReturnValue(null);
  });

  it("refreshes an enrolled device and reports the timestamps as ISO strings", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [storedScoutDeviceRow()] })
      .mockResolvedValueOnce({
        rows: [
          storedScoutDeviceRow({
            created_at: new Date("2026-07-04T16:00:00.000Z"),
            last_seen_at: new Date("2026-07-04T17:00:00.000Z"),
            worker_name: "Laptop renamed",
          }),
        ],
      });
    authMocks.getAuthPgPool.mockReturnValue({ query });

    const device = await registerOrTouchScoutDevice({
      defaultUploadTarget: "workspace",
      id: "worker-123",
      now: new Date("2026-07-04T17:00:00.000Z"),
      userId: "user-123",
      workerName: "Laptop renamed",
      workspaceId: "org-123",
    });

    expect(device).toEqual({
      createdAt: "2026-07-04T16:00:00.000Z",
      defaultUploadTarget: "workspace",
      id: "worker-123",
      lastSeenAt: "2026-07-04T17:00:00.000Z",
      revokedAt: null,
      searchKeyConfigured: true,
      userId: "user-123",
      workerName: "Laptop renamed",
      workspaceId: "org-123",
    });
    expect(query.mock.calls[1]?.[0]).toMatch(/UPDATE scout_devices/);
    expect(query.mock.calls[1]?.[1]).toEqual([
      "Laptop renamed",
      "workspace",
      "org-123",
      true,
      "2026-07-04T17:00:00.000Z",
      "worker-123",
    ]);
  });

  it("carries the stored search-key flag forward when the CLI omits it", async () => {
    const query = vi
      .fn<ScoutDevicePoolQuery>()
      .mockResolvedValueOnce({ rows: [storedScoutDeviceRow({ search_key_configured: 0 })] })
      .mockResolvedValueOnce({ rows: [storedScoutDeviceRow({ search_key_configured: 0 })] });
    authMocks.getAuthPgPool.mockReturnValue({ query });

    await registerOrTouchScoutDevice({
      defaultUploadTarget: "workspace",
      id: "worker-123",
      now: new Date("2026-07-04T17:00:00.000Z"),
      userId: "user-123",
      workerName: "Laptop",
      workspaceId: "org-123",
    });

    expect(query.mock.calls[1]?.[1]?.[3]).toBe(false);
  });

  it("blocks a revoked or foreign device before it writes anything", async () => {
    const revoked = vi
      .fn()
      .mockResolvedValueOnce({ rows: [storedScoutDeviceRow({ revoked_at: new Date() })] });
    authMocks.getAuthPgPool.mockReturnValue({ query: revoked });

    await expect(
      registerOrTouchScoutDevice({
        defaultUploadTarget: "workspace",
        id: "worker-123",
        userId: "user-123",
        workerName: "Laptop",
        workspaceId: null,
      }),
    ).rejects.toBeInstanceOf(ScoutDeviceRevokedError);
    expect(revoked).toHaveBeenCalledTimes(1);

    const foreign = vi
      .fn()
      .mockResolvedValueOnce({ rows: [storedScoutDeviceRow({ user_id: "someone-else" })] });
    authMocks.getAuthPgPool.mockReturnValue({ query: foreign });

    await expect(
      registerOrTouchScoutDevice({
        defaultUploadTarget: "workspace",
        id: "worker-123",
        userId: "user-123",
        workerName: "Laptop",
        workspaceId: null,
      }),
    ).rejects.toThrow("Scout device worker-123 belongs to a different user.");
    expect(foreign).toHaveBeenCalledTimes(1);
  });

  it("defaults the search-key flag to false on a fresh enrollment", async () => {
    const query = vi
      .fn<ScoutDevicePoolQuery>()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [storedScoutDeviceRow({ search_key_configured: false })] });
    authMocks.getAuthPgPool.mockReturnValue({ query });

    await registerOrTouchScoutDevice({
      defaultUploadTarget: "workspace",
      id: "worker-123",
      now: new Date("2026-07-04T16:00:00.000Z"),
      userId: "user-123",
      workerName: "Laptop",
      workspaceId: "org-123",
    });

    expect(query.mock.calls[1]?.[1]?.[5]).toBe(false);
  });

  it("fails loudly when a write returns no row instead of inventing one", async () => {
    const insert = vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    authMocks.getAuthPgPool.mockReturnValue({ query: insert });

    await expect(
      registerOrTouchScoutDevice({
        defaultUploadTarget: "workspace",
        id: "worker-123",
        userId: "user-123",
        workerName: "Laptop",
        workspaceId: null,
      }),
    ).rejects.toThrow("Scout device insert did not return a stored row.");

    const update = vi
      .fn()
      .mockResolvedValueOnce({ rows: [storedScoutDeviceRow()] })
      .mockResolvedValueOnce({ rows: [] });
    authMocks.getAuthPgPool.mockReturnValue({ query: update });

    await expect(
      registerOrTouchScoutDevice({
        defaultUploadTarget: "workspace",
        id: "worker-123",
        userId: "user-123",
        workerName: "Laptop",
        workspaceId: null,
      }),
    ).rejects.toThrow("Scout device update did not return a stored row.");
  });

  it("rejects a stored row Atlas cannot present honestly", async () => {
    const undated = vi.fn().mockResolvedValue({
      rows: [storedScoutDeviceRow({ last_seen_at: null as unknown as string })],
    });
    authMocks.getAuthPgPool.mockReturnValue({ query: undated });

    await expect(listScoutDevicesForUser("user-123")).rejects.toThrow(
      "Scout device row is missing required timestamps.",
    );

    const mistargeted = vi
      .fn()
      .mockResolvedValue({ rows: [storedScoutDeviceRow({ default_upload_target: "elsewhere" })] });
    authMocks.getAuthPgPool.mockReturnValue({ query: mistargeted });

    await expect(listScoutDevicesForUser("user-123")).rejects.toThrow(
      "Scout device row has an invalid upload target.",
    );
  });

  it("completes a revocation that matched exactly one row", async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    authMocks.getAuthPgPool.mockReturnValue({ query });

    await expect(
      revokeScoutDevice({ deviceId: "worker-123", userId: "user-123" }),
    ).resolves.toBeUndefined();
  });
});

describe("scout-devices without an auth database", () => {
  beforeEach(() => {
    authMocks.getAuthPgPool.mockReturnValue(null);
    authMocks.getAuthDatabase.mockReturnValue(null);
  });

  it("refuses every device operation rather than reporting a silent success", async () => {
    await expect(
      registerOrTouchScoutDevice({
        defaultUploadTarget: "public",
        id: "worker-123",
        userId: "user-123",
        workerName: "Laptop",
        workspaceId: null,
      }),
    ).rejects.toThrow("Auth database unavailable in current mode");
    await expect(listScoutDevicesForUser("user-123")).rejects.toThrow(
      "Auth database unavailable in current mode",
    );
    await expect(revokeScoutDevice({ deviceId: "worker-123", userId: "user-123" })).rejects.toThrow(
      "Auth database unavailable in current mode",
    );
  });
});
