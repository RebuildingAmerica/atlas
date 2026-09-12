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
  listScoutDevicesForUser,
  registerOrTouchScoutDevice,
  revokeScoutDevice,
} from "@/domains/access/server/scout-devices";

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
