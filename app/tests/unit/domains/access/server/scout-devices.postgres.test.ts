import type Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  getAuthDatabase: vi.fn<() => Database.Database | null>(),
  getAuthPgPool: vi.fn<() => unknown>(),
}));

vi.mock("@tanstack/react-start/server-only", () => ({}));
vi.mock("@/domains/access/server/auth", () => authMocks);

import {
  ScoutDeviceRevokedError,
  listScoutDevicesForUser,
  registerOrTouchScoutDevice,
  revokeScoutDevice,
} from "@/domains/access/server/scout-devices";
import { storedScoutDeviceRow, type ScoutDevicePoolQuery } from "./scout-devices-test-support";

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
