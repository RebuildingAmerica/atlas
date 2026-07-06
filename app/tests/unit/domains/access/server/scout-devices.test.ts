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
